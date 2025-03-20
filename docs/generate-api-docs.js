#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Paths
const ROOT_DIR = path.join(__dirname, '..');
const API_DIR = path.join(__dirname, 'pages', 'api');
const GENERATED_DIR = path.join(API_DIR, 'generated');

// Create the API directory if it doesn't exist
if (!fs.existsSync(API_DIR)) {
  fs.mkdirSync(API_DIR, { recursive: true });
}

// Create index.md file for the API section if it doesn't exist
const apiIndexFile = path.join(API_DIR, 'index.md');
if (!fs.existsSync(apiIndexFile)) {
  console.log('Creating API index file...');
  const apiIndexContent = `---
layout: default
title: API
permalink: /api/
has_children: true
nav_order: 2
---

v${require('../package.json').version}
{: .label .label-green }

# 📘 API Documentation

This section contains the API documentation for Shoehive, automatically generated from source code.
`;
  fs.writeFileSync(apiIndexFile, apiIndexContent);
}

// Make sure the generated directory exists
if (!fs.existsSync(GENERATED_DIR)) {
  fs.mkdirSync(GENERATED_DIR, { recursive: true });
}

// Generate documentation using TypeDoc
console.log('Generating API documentation with TypeDoc...');
try {
  execSync('npx typedoc', { cwd: ROOT_DIR, stdio: 'inherit' });
} catch (error) {
  console.error('TypeDoc generation failed:', error);
  process.exit(1);
}

// Process the generated files to add proper frontmatter
console.log('Processing generated files to add frontmatter...');

/**
 * Escape a string for use in YAML frontmatter
 * @param {string} str The string to escape
 * @return {string} The escaped string
 */
function escapeYaml(str) {
  if (!str) return '';
  
  // If the string contains YAML special characters, wrap it in quotes
  if (str.includes(':') || str.includes('{') || str.includes('}') || 
      str.includes('[') || str.includes(']') || str.includes('&') || 
      str.includes('*') || str.includes('?') || str.includes('|') || 
      str.includes('-') || str.includes('>') || str.includes('!') ||
      str.includes('%') || str.includes('@') || str.includes('`')) {
    // Escape double quotes inside the string and wrap in double quotes
    return `"${str.replace(/"/g, '\\"')}"`;
  }
  
  return str;
}

/**
 * Fix markdown links to use permalinks instead of raw .md files
 * @param {string} content Markdown content
 * @param {string} basePath Base path for the permalinks
 * @return {string} Content with fixed links
 */
function fixLinks(content, basePath) {
  if (!content) return '';
  
  // For debugging
  const originalLinks = content.match(/\[[^\]]+\]\([^)]+\.md[^)]*\)/g) || [];
  if (originalLinks.length > 0) {
    console.log(`Found ${originalLinks.length} markdown links to convert`);
    // Uncomment for detailed debugging
    // originalLinks.forEach(link => console.log(`  Original: ${link}`));
  }
  
  let processedContent = content;
  
  // Handle links with fragment identifiers (#section-name) where file and directory have the same name
  // Example: /api/classes/messagerouter/MessageRouter.md#processmessage -> /api/classes/messagerouter/#processmessage
  processedContent = processedContent.replace(
    /\[([^\]]+)\]\(([\/\w-]+)\/([^\/\s]+)\/\3\.md(#[\w-]+)\)/gi,
    (match, linkText, basePath, dirName, fragment) => {
      return `[${linkText}](${basePath}/${dirName.toLowerCase()}/${fragment})`;
    }
  );
  
  // Handle general links with fragment identifiers
  // Example: path/to/something.md#section -> /api/path/to/something/#section
  processedContent = processedContent.replace(
    /\[([^\]]+)\]\(([^)]+)\.md(#[\w-]+)\)/g,
    (match, linkText, linkPath, fragment) => {
      // Process the linkPath normally (without the fragment)
      let newLink;
      
      // Handle various path formats
      if (linkPath.startsWith('../') || linkPath.startsWith('./')) {
        // Relative path
        const cleanPath = linkPath.replace(/^(?:\.\.\/)+|^\.\//g, '').toLowerCase();
        newLink = `/api/${cleanPath}/`;
      } else if (linkPath.startsWith('/')) {
        // Absolute path
        newLink = `/api${linkPath.toLowerCase()}/`;
      } else if (linkPath.includes('/')) {
        // Path with directory structure but not starting with / or ./
        newLink = `/api/${linkPath.toLowerCase()}/`;
      } else {
        // Same directory file
        newLink = `${basePath}${linkPath.toLowerCase()}/`;
      }
      
      return `[${linkText}](${newLink}${fragment})`;
    }
  );
  
  // Handle TypeDoc-specific formats first - these often have specific formats like [**shoehive**](../README.md)
  processedContent = processedContent.replace(
    /\[([^\]]+)\]\(([^)]+)\/README\.md\)/g,
    (match, linkText, path) => {
      return `[${linkText}](/api/generated/)`;
    }
  );
  
  // Replace links to classes, interfaces, etc.
  processedContent = processedContent.replace(
    /\[([^\]]+)\]\(\.\.\/classes\/([^)]+)\.md\)/g,
    (match, linkText, className) => {
      return `[${linkText}](/api/classes/${className.toLowerCase()}/)`;
    }
  );
  
  processedContent = processedContent.replace(
    /\[([^\]]+)\]\(\.\.\/interfaces\/([^)]+)\.md\)/g,
    (match, linkText, interfaceName) => {
      return `[${linkText}](/api/interfaces/${interfaceName.toLowerCase()}/)`;
    }
  );
  
  processedContent = processedContent.replace(
    /\[([^\]]+)\]\(\.\.\/enumerations\/([^)]+)\.md\)/g,
    (match, linkText, enumName) => {
      return `[${linkText}](/api/enumerations/${enumName.toLowerCase()}/)`;
    }
  );
  
  processedContent = processedContent.replace(
    /\[([^\]]+)\]\(\.\.\/functions\/([^)]+)\.md\)/g,
    (match, linkText, fnName) => {
      return `[${linkText}](/api/functions/${fnName.toLowerCase()}/)`;
    }
  );
  
  // General relative path links (catches ../ and ./ prefixes)
  processedContent = processedContent.replace(
    /\[([^\]]+)\]\(((?:\.\.\/)+|\.\/)([\w\/-]+)\.md\)/g, 
    (match, linkText, relativePath, linkPath) => {
      const permalinkPath = linkPath.toLowerCase();
      return `[${linkText}](/api/${permalinkPath}/)`;
    }
  );
  
  // Handle links in the same directory (no ./ prefix)
  processedContent = processedContent.replace(
    /\[([^\]]+)\]\((?!https?:\/\/)(?!\/|\.\/|\.\.\/)([\w-]+)\.md\)/g,
    (match, linkText, linkPath) => {
      const permalinkPath = linkPath.toLowerCase();
      return `[${linkText}](${basePath}${permalinkPath}/)`;  
    }
  );
  
  // Handle absolute paths
  processedContent = processedContent.replace(
    /\[([^\]]+)\]\((\/[\w\/-]+)\.md\)/g,
    (match, linkText, linkPath) => {
      const permalinkPath = linkPath.toLowerCase();
      return `[${linkText}](/api/${permalinkPath}/)`;
    }
  );
  
  // Special case for README.md in the same directory
  processedContent = processedContent.replace(
    /\[([^\]]+)\]\(README\.md\)/g,
    (match, linkText) => {
      return `[${linkText}](/api/generated/)`;
    }
  );
  
  // Final check to see if we missed any .md links
  const remainingLinks = processedContent.match(/\[[^\]]+\]\([^)]+\.md[^)]*\)/g) || [];
  if (remainingLinks.length > 0) {
    console.log(`WARNING: ${remainingLinks.length} markdown links weren't converted:`);
    remainingLinks.forEach(link => console.log(`  Remaining: ${link}`));
  }
  
  return processedContent;
}

/**
 * Special handling for processing the README.md file in the generated directory
 * @param {string} content The README.md content
 * @return {string} Processed content with fixed links
 */
function processReadmeLinks(content) {
  if (!content) return '';
  
  let processedContent = content;
  
  // Handle the specific README.md link format: [TableState](enumerations/TableState.md)
  processedContent = processedContent.replace(
    /\[([^\]]+)\]\((enumerations|classes|interfaces|functions)\/([^)]+)\.md\)/g,
    (match, linkText, type, itemName) => {
      return `[${linkText}](/api/${type.toLowerCase()}/${itemName.toLowerCase()}/)`;
    }
  );
  
  // Handle links with 'enums' instead of 'enumerations'
  processedContent = processedContent.replace(
    /\[([^\]]+)\]\((enums)\/([^)]+)\.md\)/g,
    (match, linkText, type, itemName) => {
      return `[${linkText}](/api/enums/${itemName.toLowerCase()}/)`;
    }
  );
  
  return processedContent;
}

/**
 * Add Jekyll frontmatter to TypeDoc generated files
 */
function processDirectory(dir, parentTitle = 'API', parentPath = '/api/', parentGrandparent = null, depth = 0) {
  if (!fs.existsSync(dir)) {
    console.error(`Directory does not exist: ${dir}`);
    return;
  }
  
  const items = fs.readdirSync(dir, { withFileTypes: true });
  const navOrder = {};

  // First, collect all files and calculate navigation order
  items.forEach((item, index) => {
    // Set nav_order based on position in the directory
    navOrder[item.name] = index + 1;
  });

  // Create the directory's index.md file first
  const dirName = path.basename(dir);
  const dirTitle = formatTitle(dirName);
  
  // Special case for the root generated directory
  if (dirName === 'generated') {
    const readmePath = path.join(dir, 'README.md');
    const indexPath = path.join(dir, 'index.md');
    
    // If README.md exists, use it as the content for index.md
    if (fs.existsSync(readmePath)) {
      console.log('Using README.md as the index for generated API...');
      let readmeContent = fs.readFileSync(readmePath, 'utf8');
      
      // First, apply the special README processing
      console.log('Converting links in README.md to permalinks...');
      readmeContent = processReadmeLinks(readmeContent);
      
      // Then apply the standard link fixing
      const fixedContent = fixLinks(readmeContent, `${parentPath}${dirName}/`);
      
      const indexContent = `---
layout: default
title: API Reference
permalink: ${parentPath}${dirName}/
has_children: true
nav_order: 4
---

v${require('../package.json').version}
{: .label .label-green }
${fixedContent}`;
      
      fs.writeFileSync(indexPath, indexContent);
      console.log(`Created index.md from README.md for: ${parentPath}${dirName}/`);
      
      // Remove the README.md file since we've merged it into index.md
      fs.unlinkSync(readmePath);
      console.log('Removed original README.md file');
      
      // Double-check the index file for any remaining .md links
      const indexContent2 = fs.readFileSync(indexPath, 'utf8');
      const remainingLinks = indexContent2.match(/\[[^\]]+\]\([^)]+\.md[^)]*\)/g) || [];
      if (remainingLinks.length > 0) {
        console.log(`WARNING: ${remainingLinks.length} markdown links in index.md weren't converted:`);
        remainingLinks.forEach(link => console.log(`  Remaining: ${link}`));
      }
    } else {
      // If README.md doesn't exist, create a simple index.md
      const indexContent = `---
layout: default
title: API Reference
permalink: ${parentPath}${dirName}/
has_children: true
nav_order: 4
---

v${require('../package.json').version}
{: .label .label-green }

# Generated API Reference

This section contains the automatically generated API documentation for Shoehive.
`;
      fs.writeFileSync(indexPath, indexContent);
      console.log(`Created basic index for: ${parentPath}${dirName}/`);
    }
  }

  // Now process all items
  items.forEach(item => {
    const fullPath = path.join(dir, item.name);
    
    if (item.isDirectory()) {
      // Process directories
      const subDirName = item.name;
      const subDirTitle = formatTitle(subDirName);
      const subDirSlug = subDirName.toLowerCase();
      let subDirPermalink = `${parentPath}${subDirSlug}/`;
      
      if (parentPath.endsWith('/') && !parentPath.endsWith('//')) {
        // Avoid double slashes
        subDirPermalink = `${parentPath}${subDirSlug}/`;
      } else {
        subDirPermalink = `${parentPath}/${subDirSlug}/`;
      }
      
      // Create index.md for the directory if it doesn't exist
      const indexPath = path.join(fullPath, 'index.md');
      let parent = parentTitle;
      
      // Handle parent hierarchy correctly
      if (dirName === 'generated') {
        parent = 'API Reference';
      } else if (depth > 0 && parentGrandparent) {
        // For deeper levels, set up proper parent hierarchy
        parent = parentTitle;
      }
      
      // Check if index.md exists and override if needed
      if (!fs.existsSync(indexPath) || overrideNeeded(indexPath)) {
        const escapedTitle = escapeYaml(subDirTitle);
        const escapedParent = escapeYaml(parent);
        
        const indexContent = `---
layout: default
title: ${escapedTitle}
permalink: ${subDirPermalink}
parent: ${escapedParent}
has_children: true
nav_order: ${navOrder[item.name]}
---

v${require('../package.json').version}
{: .label .label-green }

# ${subDirTitle}`;
        fs.writeFileSync(indexPath, indexContent);
        console.log(`Created/updated index for: ${subDirPermalink}`);
      }
      
      // Process the subdirectory with the current directory as parent
      processDirectory(fullPath, subDirTitle, subDirPermalink, parentTitle, depth + 1);
    } else if (item.name.endsWith('.md') && item.name !== 'index.md' && item.name !== 'README.md') {
      // Process markdown files (exclude index.md and README.md)
      const content = fs.readFileSync(fullPath, 'utf8');
      
      // Extract the title from the content
      let title = '';
      const titleMatch = content.match(/^# (.+)$/m);
      if (titleMatch) {
        title = titleMatch[1].trim();
      } else {
        title = formatTitle(item.name.replace('.md', ''));
      }
      
      // Generate permalink
      const slug = item.name.replace('.md', '').toLowerCase();
      let permalink = '';
      
      if (parentPath.endsWith('/')) {
        // Avoid double slashes
        permalink = `${parentPath}${slug}/`;
      } else {
        permalink = `${parentPath}/${slug}/`;
      }
      
      // Figure out the correct parent
      let parent = parentTitle;
      if (dirName === 'generated') {
        parent = 'API Reference';
      }
      
      // Always create new frontmatter with properly escaped values
      const escapedTitle = escapeYaml(title);
      const escapedParent = escapeYaml(parent);
      
      const frontmatter = `---
layout: default
title: ${escapedTitle}
permalink: ${permalink}
parent: ${escapedParent}
nav_order: ${navOrder[item.name]}
---

v${require('../package.json').version}
{: .label .label-green }
`;
      
      // Replace existing content if needed
      if (!fileHasFrontmatter(fullPath) || overrideNeeded(fullPath)) {
        // Remove any existing frontmatter first
        const contentWithoutFrontmatter = content.replace(/^---[\s\S]*?---\n\n?/, '');
        
        // Fix links in the content
        const fixedContent = fixLinks(contentWithoutFrontmatter, parentPath);
        
        const newContent = frontmatter + fixedContent;
        fs.writeFileSync(fullPath, newContent);
        console.log(`Added frontmatter to: ${permalink}`);
      }
    }
  });
}

/**
 * Check if a file already has frontmatter
 */
function fileHasFrontmatter(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const content = fs.readFileSync(filePath, 'utf8');
  return content.startsWith('---');
}

/**
 * Check if we need to override the file's frontmatter 
 * (useful for fixing incorrect frontmatter)
 */
function overrideNeeded(filePath) {
  // For this run, we'll override all files to ensure consistency
  return true;
}

/**
 * Format directory or file name into a title
 */
function formatTitle(name) {
  // Remove any leading numbers and underscores (e.g., 1_name -> name)
  name = name.replace(/^\d+_/, '');
  
  // Replace hyphens and underscores with spaces
  name = name.replace(/[-_]/g, ' ');
  
  // Capitalize first letter of each word
  name = name.replace(/\b\w/g, l => l.toUpperCase());
  
  return name;
}

// Process the generated directory
processDirectory(GENERATED_DIR);

console.log('API documentation processing complete!');

// Update .gitignore to include the generated directory but exclude files
const gitignoreFile = path.join(GENERATED_DIR, '.gitignore');
fs.writeFileSync(gitignoreFile, '*\n!.gitignore\n');
console.log('Added .gitignore to exclude generated files from git'); 