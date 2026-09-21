import type { en } from "../i18n/locales/en";

type Resource = typeof en;
type BaseKey<K> = K extends `${infer Base}_one` | `${infer Base}_other`
  ? Base
  : K;
export type MessageKey = BaseKey<keyof Resource>;
type Template<K extends MessageKey> = K extends keyof Resource
  ? Resource[K]
  : `${K}_other` extends keyof Resource
    ? Resource[`${K}_other`]
    : never;
type Variables<S extends string> =
  S extends `${string}{{${infer P}}}${infer Rest}`
    ? P | Variables<Rest>
    : never;
export type MessageParams<K extends MessageKey> = {
  [P in Variables<Template<K>>]: P extends "count"
    ? number
    : string | number | Message;
};
export interface KeyMessage {
  kind: "message";
  key: MessageKey;
  params: Record<string, string | number | Message>;
}
/** Strings are opaque external text, never translation keys. */
export type Message =
  string | KeyMessage | { kind: "joined"; parts: Message[]; separator: string };
export function msg<K extends MessageKey>(
  key: K,
  ...args: keyof MessageParams<K> extends never
    ? []
    : [params: MessageParams<K>]
): KeyMessage {
  return { kind: "message", key, params: args[0] ?? {} } as KeyMessage;
}
export function joinMessages(parts: Message[], separator = "\n"): Message {
  return { kind: "joined", parts, separator };
}
/** Stable across structured cloning and parameter insertion order. */
export function messageIdentity(value: Message | undefined): string {
  if (value === undefined) return "undefined";
  if (typeof value === "string") return JSON.stringify(value);
  if (value.kind === "joined")
    return JSON.stringify([
      "joined",
      value.separator,
      value.parts.map(messageIdentity),
    ]);
  return JSON.stringify([
    value.key,
    Object.entries(value.params)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, param]) => [
        key,
        typeof param === "number" ? param : messageIdentity(param),
      ]),
  ]);
}
export const sameMessage = (a: Message | undefined, b: Message | undefined) =>
  messageIdentity(a) === messageIdentity(b);
export function uniqueMessages(messages: Message[]): Message[] {
  return [
    ...new Map(
      messages.map((message) => [messageIdentity(message), message]),
    ).values(),
  ];
}
/** Runtime guard for error descriptors crossing Figma and Worker boundaries. */
export function isMessage(value: unknown): value is Exclude<Message, string> {
  if (!value || typeof value !== "object") return false;
  const m = value as Record<string, unknown>;
  if (m.kind === "joined")
    return (
      typeof m.separator === "string" &&
      Array.isArray(m.parts) &&
      m.parts.every((p) => typeof p === "string" || isMessage(p))
    );
  return (
    m.kind === "message" &&
    typeof m.key === "string" &&
    !!m.params &&
    typeof m.params === "object" &&
    Object.values(m.params).every(
      (p) => typeof p === "string" || typeof p === "number" || isMessage(p),
    )
  );
}
