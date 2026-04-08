import { Project, SyntaxKind, ParameterDeclaration, ObjectLiteralExpression, ArrowFunction, FunctionExpression, Node } from "ts-morph";

const project = new Project({
  tsConfigFilePath: "./tsconfig.json",
});

const skipFunctions = new Set(["constructor", "setupEventListeners", "on", "once", "off", "emit", "addListener", "removeListener", "removeAllListeners"]);

function transformSignature(node: any) {
  const nodeName = node.getName ? node.getName() : undefined;
  if (nodeName && skipFunctions.has(nodeName)) return;

  const parameters = node.getParameters();
  if (parameters.length === 0) return;

  if (parameters.length === 1) {
      const p = parameters[0];
      if (p.getName() === "options" || p.getNameNode().getKind() === SyntaxKind.ObjectBindingPattern) {
          return;
      }
  }

  const paramNames = parameters.map((p: ParameterDeclaration) => p.getName());
  const typeElements: string[] = [];
  const destructureElements: string[] = [];

  for (const param of parameters) {
    const name = param.getName();
    // Improved optional check
    const isOptional = param.isOptional() || param.getInitializer() || (param.hasQuestionToken && param.hasQuestionToken());
    
    const typeNode = param.getTypeNode()?.getText() || "any";
    const init = param.getInitializer ? param.getInitializer() : undefined;
    const initText = init ? ` = ${init.getText()}` : "";
    destructureElements.push(`${name}${initText}`);
    typeElements.push(`${name}${isOptional ? "?" : ""}: ${typeNode}`);
  }

  const optionsTypeString = `{ ${typeElements.join(", ")} }`;
  const isInterface = node.getKind() === SyntaxKind.MethodSignature;
  const optionsDestructureString = isInterface ? "options" : `{ ${destructureElements.join(", ")} }`;
  
  // Recompute isAllOptional for the default {} value
  const isAllOptional = parameters.every((p: ParameterDeclaration) => p.isOptional() || p.getInitializer() || (p.hasQuestionToken && p.hasQuestionToken()));

  const references = node.findReferencesAsNodes ? node.findReferencesAsNodes() : [];
  for (const ref of references) {
    if (ref.wasForgotten()) continue;
    const callExp = ref.getFirstAncestorByKind(SyntaxKind.CallExpression);
    if (callExp && !callExp.wasForgotten() && nodeName && callExp.getExpression().getText().endsWith(nodeName)) {
      const args = callExp.getArguments();
      
      if (args.length === 1 && args[0].getKind() === SyntaxKind.ObjectLiteralExpression) {
          const obj = args[0] as ObjectLiteralExpression;
          const propNames = obj.getProperties().map(p => (p as any).getName ? (p as any).getName() : "");
          if (propNames.length === parameters.length && propNames.every(name => paramNames.includes(name))) {
              continue;
          }
      }

      const newArgsProperties: string[] = [];
      args.forEach((arg: any, index: number) => {
        if (index < parameters.length) {
          const paramName = parameters[index].getName();
          newArgsProperties.push(`${paramName}: ${arg.getText()}`);
        }
      });

      if (newArgsProperties.length > 0) {
        for (let i = args.length - 1; i >= 0; i--) callExp.removeArgument(i);
        callExp.addArgument(`{ ${newArgsProperties.join(", ")} }`);
      } else if (isAllOptional) {
          // If no args provided but all optional, provide empty object if none there
          if (args.length === 0) {
              callExp.addArgument("{}");
          }
      }
    }
  }

  for (let i = parameters.length - 1; i >= 0; i--) parameters[i].remove();
  node.addParameter({
    name: optionsDestructureString,
    type: optionsTypeString,
    initializer: (isAllOptional && !isInterface) ? "{}" : undefined
  });
}

project.addSourceFilesAtPaths(["src/**/*.ts", "tests/**/*.ts"]);
const sourceFiles = project.getSourceFiles();

console.log("Starting main transformation...");
for (const sourceFile of sourceFiles) {
  sourceFile.getDescendantsOfKind(SyntaxKind.MethodDeclaration).forEach(transformSignature);
  sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration).forEach(transformSignature);
  sourceFile.getDescendantsOfKind(SyntaxKind.MethodSignature).forEach(transformSignature);
}

console.log("Applying EventBus/Special rules...");
for (const sourceFile of sourceFiles) {
    const calls = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
    for (const call of calls) {
        if (call.wasForgotten()) continue;
        const text = call.getExpression().getText();
        
        if (text.endsWith(".emit")) {
            const args = call.getArguments();
            if (args.length > 1) {
                const payloadArgs = args.slice(1);
                if (payloadArgs.length === 1 && payloadArgs[0].getKind() === SyntaxKind.ObjectLiteralExpression) continue;

                const props = payloadArgs.map((a, i) => {
                    const t = a.getText();
                    if (t === "this") return `table: this`;
                    if (t.match(/^[a-zA-Z_$][a-zA-Z0-9_$]*$/)) return t;
                    return `arg${i}: ${t}`;
                }).join(", ");
                for (let i = args.length - 1; i >= 1; i--) call.removeArgument(i);
                call.addArgument(`{ ${props} }`);
            }
        }

        if (text.endsWith(".on") || text.endsWith(".once") || text.endsWith(".off")) {
            if (text.includes("eventBus")) {
                const args = call.getArguments();
                if (args.length === 2) {
                    const eventArgText = args[0].getText();
                    const listenerArg = args[1];
                    const listenerText = listenerArg.getText();
                    call.removeArgument(1);
                    call.removeArgument(0);
                    call.addArgument(`{ event: ${eventArgText}, listener: ${listenerText} }`);
                }
            }
        }
    }
}

// Fix EventBus implementation
const ebFile = project.getSourceFile("src/events/EventBus.ts");
if (ebFile) {
    const eb = ebFile.getClass("EventBus");
    if (eb) {
        ["on", "once", "off"].forEach(mName => {
            const m = eb.getMethod(mName);
            if (m) {
                m.getParameters().forEach(p => p.remove());
                m.addParameter({ name: "{ event, listener }", type: "{ event: EventType | string, listener: (payload: any) => void }" });
            }
        });
        const lc = eb.getMethod("listenerCount");
        if (lc) {
             lc.getParameters().forEach(p => p.remove());
             lc.addParameter({ name: "{ event }", type: "{ event: EventType | string }" });
        }
        const emit = eb.getMethod("emit");
        if (emit) {
            emit.getParameters().slice(1).forEach(p => p.remove());
            if (emit.getParameters().length === 1) {
                emit.addParameter({ name: "payload", type: "any", initializer: "{}" });
            }
            emit.setBodyText(`
    const result = this.originalEmit.call(this.emitter, event, payload);
    if (this.debugEnabled) {
      if (!this.debugFilter || this.debugFilter(event)) {
        this.debugLogger(\`[EVENT] \${event}\`, payload);
      }
    }
    return result;
            `);
        }
    }
}

project.saveSync();
console.log("Transformation completed.");
