<!--
  contracts.md — the typed surfaces shared across work-items. Lives in <planDir> alongside
  work-phases.md. This is a FILL-IN-THE-BLANKS template; replace every <angle-bracket placeholder>
  and delete this comment.
-->

# <Project / epic name> — Contracts

Contracts are the **typed surfaces between work-items** — the agreed interfaces that let parallel
items build against each other **without reading each other's code.** Each contract has exactly one
**producer** (the item that creates the surface) and one or more **consumers** (items that depend on
it). A consumer's code must match the shape here exactly; a producer that deviates from this file
breaks everything downstream.

**Write each signature in your project's own language** — TypeScript `type`s/interfaces, Python type
hints / dataclasses / Pydantic models, Go interfaces/structs, a SQL DDL block, an HTTP
request/response schema, etc. The examples below use `<pseudo-types>` in angle brackets; replace them
with real signatures in your language. Give each contract a stable id (`C1`, `C2`, …) so work-items
and architectural rules can cite it.

---

## C1 — <name of the surface, e.g. "Domain types" or "DB client">

**Producer:** <work-item-Wx.y>
**Consumers:** <work-item-Wx.y, work-item-Wx.z, all P<n> items>

<One or two sentences: what this surface is, and any naming/representation convention a consumer must
follow (e.g. "field names are camelCase in transport, snake_case in storage; the DB layer maps").>

```
<!-- The exact signature/shape, in your project's language. Examples: -->

<!-- TypeScript: -->
export type <TypeName> = {
  <field>: <type>;
  <field>: <type> | null;
};
export function <fnName>(<arg>: <type>): <returnType>;

<!-- or Python: -->
# class <ModelName>(BaseModel):
#     <field>: <type>
# def <fn_name>(<arg>: <type>) -> <return_type>: ...

<!-- or Go: -->
// type <Name> interface { <Method>(<arg> <type>) (<ret>, error) }
```

---

## C2 — <name of the next surface>

**Producer:** <work-item-Wx.y>
**Consumers:** <work-item-Wx.y, work-item-Wx.z>

<What it is + any invariant a consumer must honor (e.g. an error envelope shape, a status-code
contract, a rounding rule, an ordering guarantee).>

```
<!-- signature / shape in your language -->
<symbol>(<arg>: <type>): <type>
```

<!--
  Add as many contracts as the plan needs. A good contract is anything two or more work-items must
  agree on without reading each other's implementation: shared types/schemas, a DB client surface,
  an API error envelope + status codes, a shared util's signature (formatting/derivation), a shared
  presentational component's props, a query helper's return shape.
-->
