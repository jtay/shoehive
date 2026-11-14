/**
 * Shoehive core: game definitions, the engine and protocol types.
 *
 * This entry point is isomorphic. It must never import Node built-ins (ADR 0002).
 * The engine lands in Phase 1 (RFC 0001, section 12).
 *
 * @packageDocumentation
 */
export { PROTOCOL_VERSION } from './protocol/version';
