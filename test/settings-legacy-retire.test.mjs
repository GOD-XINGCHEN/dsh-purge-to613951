import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as core from "../lib/core.js";
import { hostFs } from "../lib/extract-asar.js";

const CLEAN_SETTINGS_FIXTURE = [
  'import { existsSync } from "node:fs";',
  'import { readFile, rename } from "node:fs/promises";',
  'import { join } from "node:path";',
  'import { parse } from "yaml";',
  'import { Service, resolveConfig } from "@deepseek-ai/cordis";',
  'import { interpolate } from "@deepseek-ai/cordis-plugin-loader";',
  'import z from "@deepseek-ai/schemastery";',
  'import { isVolatile } from "@deepseek-ai/cosmokit";',
  "",
  "function plainConfig(value) {",
  "\tif (isVolatile(value)) return plainConfig(value.get());",
  "\tif (Array.isArray(value)) return value.map(plainConfig);",
  '\tif (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, plainConfig(child)]));',
  "\treturn value;",
  "}",
  "function isPlainObject(value) {",
  '\tif (typeof value !== "object" || value === null || Array.isArray(value)) return false;',
  "\tconst proto = Object.getPrototypeOf(value);",
  "\treturn proto === Object.prototype || proto === null;",
  "}",
  "function applyPathOp(section, op, schema) {",
  "\treturn { ...section, [op.path[0]]: op.value };",
  "}",
  "function mergeLayers(under, over) {",
  "\tif (!isPlainObject(under) || !isPlainObject(over)) return over;",
  "\treturn { ...under, ...over };",
  "}",
  "function inheritedConfig(runtime, inherited) {",
  "\ttry {",
  "\t\treturn resolveConfig(runtime, inherited);",
  "\t} catch (_error) {",
  "\t\treturn inherited;",
  "\t}",
  "}",
  "/** Project Config schemas into forms and own optional instance-level UI policy. */",
  "var SettingsForms = class extends Service {",
  "\townerContext;",
  '\tstatic inject = ["configEditor", "profileContext"];',
  "\trevisions = /* @__PURE__ */ new Map();",
  "\tclosed = false;",
  "\tscheduled = false;",
  "\tpresentations = /* @__PURE__ */ new Map();",
  "\tconstructor(ownerContext) {",
  '\t\tsuper(ownerContext, "settings");',
  "\t\tthis.ownerContext = ownerContext;",
  "\t\tconst ctx = ownerContext;",
  "\t\tctx.effect(() => () => {",
  "\t\t\tthis.closed = true;",
  "\t\t});",
  '\t\tctx.on("app-boot/config-reload", () => {',
  "\t\t\tthis.invalidate();",
  "\t\t});",
  "\t}",
  "\t/** Register the calling plugin instance's page policy without changing its Config.",
  "\t* @param presentation Automatic-page policy for this instance; `auto` defaults to true.",
  "\t* @param owner Plugin instance the policy belongs to; defaults to the calling fiber.",
  "\t* @returns Disposer; register it with the calling plugin's effects.",
  "\t* @throws If this instance already has a registered policy.",
  "\t*/",
  "\tconfigure(presentation, owner = this.ctx.fiber) {",
  "\t\tconst fiber = owner.ctx.fiber;",
  '\t\tif (this.presentations.has(fiber)) throw new Error("Settings presentation is already configured for this plugin instance");',
  "\t\tconst policy = { ...presentation };",
  "\t\tthis.presentations.set(fiber, policy);",
  "\t\tthis.invalidate();",
  "\t\treturn () => {",
  "\t\t\tif (this.presentations.get(fiber) !== policy) return;",
  "\t\t\tthis.presentations.delete(fiber);",
  "\t\t\tthis.invalidate();",
  "\t\t};",
  "\t}",
  "\tdescribe(options) {",
  "\t\tconst active = /* @__PURE__ */ new Set();",
  "\t\tconst descriptors = this.ownerContext.configEditor.configuration().flatMap(({ entry, inherited, override }) => {",
  "\t\t\tconst schema = this.schema(entry);",
  "\t\t\tconst form = volatileForm(schema);",
  "\t\t\tactive.add(entry.id);",
  "\t\t\tconst raw = JSON.stringify([",
  "\t\t\t\tentry.fiber.uid,",
  "\t\t\t\tschema.toJSON(),",
  "\t\t\t\tentry.options.config ?? {}",
  "\t\t\t]);",
  "\t\t\tconst autoGenerate = this.presentations.get(entry.fiber.ctx.fiber)?.auto ?? true;",
  "\t\t\tconst previous = this.revisions.get(entry.id);",
  "\t\t\tconst revision = previous === void 0 ? 0 : previous.revision + Number(previous.raw !== raw);",
  "\t\t\tthis.revisions.set(entry.id, { raw, revision, ns: entry.options.id, autoGenerate });",
  '\t\t\tif (previous?.raw !== raw || previous.autoGenerate !== autoGenerate) this.ownerContext.emit("settings/document-updated", entry.options.id, revision);',
  "\t\t\tconst resolved = interpolate(entry.fiber.ctx, inherited);",
  "\t\t\treturn [{ ns: entry.options.id, revision, resolved, user: override }];",
  "\t\t});",
  "\t\tfor (const [id, previous] of this.revisions) {",
  "\t\t\tif (active.has(id) || previous.raw === void 0) continue;",
  "\t\t\tconst revision = previous.revision + 1;",
  "\t\t\tthis.revisions.set(id, { ...previous, raw: void 0, revision });",
  '\t\t\tthis.ownerContext.emit("settings/document-updated", previous.ns, revision);',
  "\t\t}",
  "\t\treturn descriptors;",
  "\t}",
  "\tasync mutate(ns, ops, expectedRevision) {",
  "\t\tawait this.write(ns, (current, base, schema) => ops.reduce((value, op) => {",
  '\t\t\tif (op.op === "set") return applyPathOp(value, op, schema);',
  "\t\t\treturn value;",
  "\t\t}, current), expectedRevision, ops.map((op) => op.path));",
  "\t}",
  "};",
  "export { SettingsForms, SettingsForms as default };",
  "",
].join("\n");

const PATCHED_SETTINGS_FIXTURE = CLEAN_SETTINGS_FIXTURE
  .replace(
    [
      'import { existsSync } from "node:fs";',
      'import { readFile, rename } from "node:fs/promises";',
      'import { join } from "node:path";',
      'import { parse } from "yaml";',
    ].join("\n"),
    [
      'import { existsSync, readFileSync } from "node:fs";',
      'import { readFile, rename, writeFile } from "node:fs/promises";',
      'import { join } from "node:path";',
      'import { parse, stringify } from "yaml";',
    ].join("\n"),
  )
  .replace(
    "var SettingsForms = class extends Service {",
    "var SettingsForms = class extends Service { // [dsh-purge] legacy settings api",
  )
  .replace(
    "\t\tthis.ownerContext = ownerContext;",
    [
      "\t\tthis.ownerContext = ownerContext; // [dsh-purge] legacy settings api",
      "\t\tthis.legacyRegistrations = /* @__PURE__ */ new Map(); // [dsh-purge] legacy settings api",
    ].join("\n"),
  )
  .replace(
    "\tconfigure(presentation, owner = this.ctx.fiber) {",
    [
      "\tregister(ns, schema, options) {",
      "\t\tif (!/^[a-z][a-z0-9-]*$/.test(ns)) throw new TypeError(`settings namespace \"${ns}\" must match /^[a-z][a-z0-9-]*$/`);",
      "\t\tif (this.legacyRegistrations.has(ns)) throw new Error(`settings namespace \"${ns}\" is already registered`);",
      "\t\tthis.ensureLegacyDocument();",
      "\t\tconst stored = this.legacyDocument[ns];",
      "\t\tconst user = isPlainObject(stored) ? stored : void 0;",
      "\t\tconst resolved = plainConfig(schema(mergeLayers(options?.base ?? {}, user ?? {}))); // [dsh-purge] #86 plainConfig before validate + #89 ?? {} 兜 over=undefined 丢 base",
      "\t\toptions?.validate?.(resolved);",
      "\t\tconst registration = {",
      "\t\t\tns,",
      "\t\t\tschema,",
      "\t\t\tbase: options?.base,",
      '\t\t\tapplies: options?.applies ?? "live",',
      "\t\t\tvalidate: options?.validate,",
      "\t\t\tresolved,",
      "\t\t\trevision: 0,",
      "\t\t\tuser,",
      "\t\t\twatchers: /* @__PURE__ */ new Set()",
      "\t\t};",
      "\t\tthis.legacyRegistrations.set(ns, registration);",
      "\t\tthis.ctx.effect(() => () => this.legacyRegistrations.delete(ns), `settings.register(${JSON.stringify(ns)})`);",
      "\t\tconst owner = this;",
      "\t\treturn {",
      "\t\t\tget: () => registration.resolved,",
      "\t\t\twatch: (callback) => {",
      "\t\t\t\tconst watcher = { callback, active: true };",
      "\t\t\t\tregistration.watchers.add(watcher);",
      "\t\t\t\treturn () => {",
      "\t\t\t\t\twatcher.active = false;",
      "\t\t\t\t\tregistration.watchers.delete(watcher);",
      "\t\t\t\t};",
      "\t\t\t},",
      "\t\t\tupdate: (patch) => owner.commitLegacy(ns, (current) => mergeLayers(current ?? {}, patch)),",
      "\t\t\treplace: (section) => owner.commitLegacy(ns, () => section)",
      "\t\t};",
      "\t}",
      "\tget(ns) {",
      "\t\tconst legacy = this.legacyRegistrations?.get(ns);",
      "\t\tif (legacy) return legacy.resolved;",
      "\t\ttry {",
      "\t\t\tconst row = this.ownerContext.configEditor.configuration().find((item) => item.entry?.options?.id === ns);",
      "\t\t\tconst config = row?.entry?.fiber?.config;",
      "\t\t\treturn config === void 0 ? void 0 : plainConfig(config);",
      "\t\t} catch {",
      "\t\t\treturn void 0;",
      "\t\t}",
      "\t}",
      "\tensureLegacyDocument() {",
      "\t\tif (this.legacyDocument) return;",
      "\t\tconst home = this.ownerContext.profileContext.home;",
      '\t\tconst path = join(home, "settings-legacy.yaml");',
      "\t\tconst read = (file) => {",
      "\t\t\ttry {",
      '\t\t\t\tconst parsed = parse(readFileSync(file, "utf8"));',
      "\t\t\t\treturn isPlainObject(parsed) ? parsed : {};",
      "\t\t\t} catch {",
      "\t\t\t\treturn {};",
      "\t\t\t}",
      "\t\t};",
      "\t\tlet doc = {};",
      "\t\tif (existsSync(path)) doc = read(path);",
      "\t\telse {",
      '\t\t\tconst imported = join(home, "settings.yaml.imported");',
      "\t\t\tif (existsSync(imported)) doc = read(imported);",
      "\t\t}",
      "\t\tthis.legacyDocument = doc;",
      "\t\tthis.legacyPath = path;",
      "\t}",
      "\tasync persistLegacy() {",
      "\t\tthis.ensureLegacyDocument();",
      "\t\tfor (const registration of this.legacyRegistrations.values()) {",
      "\t\t\tif (registration.user !== void 0) this.legacyDocument[registration.ns] = registration.user;",
      "\t\t}",
      '\t\tawait writeFile(this.legacyPath, stringify(this.legacyDocument), "utf8");',
      "\t}",
      "\tasync commitLegacy(ns, change, expectedRevision) {",
      "\t\tconst registration = this.legacyRegistrations.get(ns);",
      "\t\tif (registration === void 0) throw new Error(`settings namespace \"${ns}\" is not registered`);",
      "\t\tif (expectedRevision !== void 0 && registration.revision !== expectedRevision) throw new SettingsConflictError(ns, expectedRevision, registration.revision);",
      "\t\tconst user = change(registration.user);",
      "\t\tconst next = plainConfig(registration.schema(mergeLayers(registration.base ?? {}, user ?? {}))); // [dsh-purge] #86 plainConfig before validate + #89 ?? {} 兜 over=undefined 丢 base",
      "\t\tregistration.validate?.(next);",
      "\t\tconst prev = registration.resolved;",
      "\t\tregistration.user = user;",
      "\t\tregistration.resolved = next;",
      "\t\tregistration.revision += 1;",
      "\t\tawait this.persistLegacy();",
      "\t\tfor (const watcher of registration.watchers) {",
      "\t\t\tif (!watcher.active) continue;",
      "\t\t\ttry {",
      "\t\t\t\twatcher.callback(next, prev);",
      "\t\t\t} catch (error) {",
      "\t\t\t\tthis.ownerContext.logger.warn(error);",
      "\t\t\t}",
      "\t\t}",
      '\t\tthis.ownerContext.emit("settings/document-updated", ns, registration.revision);',
      '\t\tthis.ownerContext.emit("settings/updated", ns, next, prev);',
      "\t}",
      "\tconfigure(presentation, owner = this.ctx.fiber) { // [dsh-purge] legacy settings api",
    ].join("\n"),
  )
  .replace(
    '\tif (previous?.raw !== raw || previous.autoGenerate !== autoGenerate) this.ownerContext.emit("settings/document-updated", entry.options.id, revision);',
    [
      "\tif (previous?.raw !== raw || previous.autoGenerate !== autoGenerate) {",
      '\t\t\t\tthis.ownerContext.emit("settings/document-updated", entry.options.id, revision);',
      '\t\t\t\tthis.ownerContext.emit("settings/updated", entry.options.id);',
      "\t\t\t}",
    ].join("\n"),
  )
  .replace(
    '\t\t\tthis.ownerContext.emit("settings/document-updated", previous.ns, revision);',
    [
      '\t\t\tthis.ownerContext.emit("settings/document-updated", previous.ns, revision);',
      '\t\t\tthis.ownerContext.emit("settings/updated", previous.ns);',
    ].join("\n"),
  )
  .replace(
    "\t\treturn descriptors;",
    [
      "\t\tconst legacy = [];",
      "\t\tfor (const registration of this.legacyRegistrations?.values() ?? []) {",
      "\t\t\ttry {",
      '\t\t\t\tconst schema = typeof registration.schema.toJSON === "function" ? registration.schema.toJSON() : {};',
      "\t\t\t\tlegacy.push({",
      "\t\t\t\t\tautoGenerate: false,",
      "\t\t\t\t\tns: registration.ns,",
      "\t\t\t\t\tschema,",
      "\t\t\t\t\trevision: registration.revision,",
      "\t\t\t\t\tapplies: registration.applies,",
      "\t\t\t\t\tvalue: registration.resolved,",
      "\t\t\t\t\t...registration.base === void 0 ? {} : { base: registration.base },",
      "\t\t\t\t\t...registration.user === void 0 ? {} : { user: registration.user }",
      "\t\t\t\t});",
      "\t\t\t} catch (error) {",
      "\t\t\t\tthis.ownerContext.logger.warn(error);",
      "\t\t\t}",
      "\t\t}",
      "\t\treturn descriptors.concat(legacy);",
    ].join("\n"),
  )
  .replace(
    "\tasync mutate(ns, ops, expectedRevision) {\n\t\tawait this.write(ns,",
    [
      "\tasync mutate(ns, ops, expectedRevision) {",
      "\t\tif (this.legacyRegistrations?.has(ns)) return this.commitLegacy(ns, (user) => (ops ?? []).reduce((section, op) => applyPathOp(section, op), user ?? {}), expectedRevision);",
      "\t\tawait this.write(ns,",
    ].join("\n"),
  );

function buildLegacyDuplicateVariantCrlf() {
  const legacyFn = [
    "function legacyApplyPath(section, op) {",
    "\tif (!op || !Array.isArray(op.path)) return section ?? {};",
    '\tif (op.path.length === 0) return op.op === "set" ? op.value : void 0;',
    "\treturn { ...section, [op.path[0]]: op.value };",
    "}",
  ].join("\n");
  const variant = PATCHED_SETTINGS_FIXTURE
    .replace(
      "/** Project Config schemas into forms",
      `${legacyFn}\n${legacyFn}\n/** Project Config schemas into forms`,
    )
    .replace(
      "mergeLayers(options?.base ?? {}, user ?? {}))); // [dsh-purge] #86 plainConfig before validate + #89 ?? {} 兜 over=undefined 丢 base",
      "mergeLayers(options?.base, user))); // [dsh-purge] #86 plainConfig before validate",
    )
    .replace(
      "mergeLayers(registration.base ?? {}, user ?? {}))); // [dsh-purge] #86 plainConfig before validate + #89 ?? {} 兜 over=undefined 丢 base",
      "mergeLayers(registration.base, user))); // [dsh-purge] #86 plainConfig before validate",
    )
    .replace(
      "=> applyPathOp(section, op), user ?? {}), expectedRevision);",
      "=> legacyApplyPath(section, op), user ?? {}), expectedRevision);",
    );
  return variant.replace(/\n/g, "\r\n");
}

function withSandbox(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-retire42-"));
  const prevHome = process.env.DSH_HOME;
  const prevSurface = process.env.DSH_SURFACE;
  const home = path.join(root, "home");
  const aiBase = path.join(root, "ai-base");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(aiBase, { recursive: true });
  process.env.DSH_HOME = home;
  process.env.DSH_SURFACE = "web";
  return Promise.resolve()
    .then(() => fn({ root, home, aiBase }))
    .finally(() => {
      if (prevHome === undefined) delete process.env.DSH_HOME;
      else process.env.DSH_HOME = prevHome;
      if (prevSurface === undefined) delete process.env.DSH_SURFACE;
      else process.env.DSH_SURFACE = prevSurface;
      fs.rmSync(root, { recursive: true, force: true });
    });
}

function writeSettingsFile(aiBase, content, bakContent = null) {
  const fp = path.join(aiBase, "dsh-settings", "lib", "index.js");
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, content, "utf8");
  if (bakContent !== null) {
    fs.writeFileSync(`${fp}.dshpurge.bak`, bakContent, "utf8");
  }
  return fp;
}

test("#42 SETTINGS_LEGACY_API is retired with safe fallback flags and empty replacements", () => {
  const p42 = core.ALL_PATCHES.find((p) => p.id === 42);
  assert.ok(p42);
  assert.equal(p42.name, "SETTINGS_LEGACY_API");
  assert.equal(p42.optional, true);
  assert.equal(p42.silentWhenMissing, true);
  assert.equal(p42.softSettle, true);
  assert.equal(p42.retired, true);
  assert.deepEqual(p42.replacements, []);
});

test("hasLegacySettingsApiPatch detects all #42 artifacts and ignores clean SettingsForms", () => {
  assert.equal(core.hasLegacySettingsApiPatch(CLEAN_SETTINGS_FIXTURE), false);
  assert.equal(core.hasLegacySettingsApiPatch(PATCHED_SETTINGS_FIXTURE), true);

  for (const artifact of [
    "// [dsh-purge] legacy settings api",
    "this.legacyRegistrations = new Map();",
    "this.ensureLegacyDocument();",
    'join(home, "settings-legacy.yaml")',
    "function legacyApplyPath(section, op) {",
    "// [dsh-purge] #86 plainConfig before validate",
    "// [dsh-purge] #89 ?? {} 兜 over=undefined 丢 base",
  ]) {
    assert.equal(core.hasLegacySettingsApiPatch(artifact), true, `expected detection for ${artifact}`);
  }

  const cleanWithOwnIo = [
    'import { existsSync, readFileSync } from "node:fs";',
    'import { readFile, rename, writeFile } from "node:fs/promises";',
    'import { parse, stringify } from "yaml";',
    "const text = readFileSync(p, 'utf8');",
    "await writeFile(p, stringify({ ok: true }), 'utf8');",
  ].join("\n");
  assert.equal(core.hasLegacySettingsApiPatch(cleanWithOwnIo), false);
  assert.equal(core.stripLegacySettingsApiPatch(cleanWithOwnIo), cleanWithOwnIo);
});

test("stripLegacySettingsApiPatch reproduces exact clean SettingsForms and is idempotent across variants", () => {
  const stripped = core.stripLegacySettingsApiPatch(PATCHED_SETTINGS_FIXTURE);
  assert.equal(stripped, CLEAN_SETTINGS_FIXTURE);
  assert.equal(core.hasLegacySettingsApiPatch(stripped), false);
  assert.equal(core.stripLegacySettingsApiPatch(stripped), stripped);

  const crlfVariant = buildLegacyDuplicateVariantCrlf();
  assert.equal(core.hasLegacySettingsApiPatch(crlfVariant), true);
  const strippedCrlf = core.stripLegacySettingsApiPatch(crlfVariant);
  assert.equal(strippedCrlf, CLEAN_SETTINGS_FIXTURE.replace(/\n/g, "\r\n"));
  assert.equal(core.hasLegacySettingsApiPatch(strippedCrlf), false);
  assert.equal(core.stripLegacySettingsApiPatch(strippedCrlf), strippedCrlf);

  const p42 = core.ALL_PATCHES.find((p) => p.id === 42);
  const repOnce = core.applyReplacementsToText(PATCHED_SETTINGS_FIXTURE, p42, "index.js");
  assert.equal(repOnce.changed, true);
  assert.equal(repOnce.text, CLEAN_SETTINGS_FIXTURE);
  const repTwice = core.applyReplacementsToText(repOnce.text, p42, "index.js");
  assert.equal(repTwice.changed, false);
  assert.equal(repTwice.text, CLEAN_SETTINGS_FIXTURE);
});

test("patchStatus and filePatchOutcome report pending when patched and off when clean", async () => {
  const p42 = core.ALL_PATCHES.find((p) => p.id === 42);
  assert.equal(core.filePatchOutcome(PATCHED_SETTINGS_FIXTURE, p42, "index.js"), "pending");
  assert.equal(core.filePatchOutcome(CLEAN_SETTINGS_FIXTURE, p42, "index.js"), "off");

  await withSandbox(async ({ aiBase }) => {
    const emptyStatus = await core.patchStatus(aiBase, [p42]);
    assert.equal(emptyStatus[42], "na");

    const fp = writeSettingsFile(aiBase, PATCHED_SETTINGS_FIXTURE);
    const dirtyStatus = await core.patchStatus(aiBase, [p42]);
    assert.equal(dirtyStatus[42], "pending");

    fs.writeFileSync(fp, CLEAN_SETTINGS_FIXTURE, "utf8");
    const cleanStatus = await core.patchStatus(aiBase, [p42]);
    assert.equal(cleanStatus[42], "off");
  });
});

test("applyPatches restores from valid .dshpurge.bak, strips when bak missing/polluted, and skips clean files", async () => {
  const p42 = core.ALL_PATCHES.find((p) => p.id === 42);

  // 1. Valid .dshpurge.bak is preferred verbatim
  await withSandbox(async ({ aiBase }) => {
    const bakClean = `${CLEAN_SETTINGS_FIXTURE}// clean-bak-sentinel\n`;
    const fp = writeSettingsFile(aiBase, PATCHED_SETTINGS_FIXTURE, bakClean);
    const report = await core.applyPatches(aiBase, [p42]);
    assert.equal(report.length, 1);
    assert.equal(report[0].status, "applied");
    assert.equal(report[0].applied, 1);
    assert.equal(fs.readFileSync(fp, "utf8"), bakClean);

    const postStatus = await core.patchStatus(aiBase, [p42]);
    assert.equal(postStatus[42], "off");
  });

  // 2. Absent .dshpurge.bak falls back to stripLegacySettingsApiPatch
  await withSandbox(async ({ aiBase }) => {
    const fp = writeSettingsFile(aiBase, PATCHED_SETTINGS_FIXTURE);
    const report = await core.applyPatches(aiBase, [p42]);
    assert.equal(report[0].status, "applied");
    assert.equal(report[0].applied, 1);
    assert.equal(fs.readFileSync(fp, "utf8"), CLEAN_SETTINGS_FIXTURE);
    assert.equal((await core.patchStatus(aiBase, [p42]))[42], "off");
  });

  // 3. Polluted or invalid .dshpurge.bak falls back to stripLegacySettingsApiPatch and heals .bak
  for (const badBak of [
    PATCHED_SETTINGS_FIXTURE,
    "",
    "// unrelated empty stub without the target class\n",
  ]) {
    await withSandbox(async ({ aiBase }) => {
      const fp = writeSettingsFile(aiBase, PATCHED_SETTINGS_FIXTURE, badBak);
      const report = await core.applyPatches(aiBase, [p42]);
      assert.equal(report[0].status, "applied");
      assert.equal(report[0].applied, 1);
      assert.equal(fs.readFileSync(fp, "utf8"), CLEAN_SETTINGS_FIXTURE);
      assert.equal(fs.readFileSync(`${fp}.dshpurge.bak`, "utf8"), CLEAN_SETTINGS_FIXTURE);
      assert.equal((await core.patchStatus(aiBase, [p42]))[42], "off");
    });
  }

  // 3b. Even when index.js is already clean, a polluted or invalid .dshpurge.bak is healed
  await withSandbox(async ({ aiBase }) => {
    const fp = writeSettingsFile(aiBase, CLEAN_SETTINGS_FIXTURE, PATCHED_SETTINGS_FIXTURE);
    const report = await core.applyPatches(aiBase, [p42]);
    assert.equal(report[0].status, "skipped");
    assert.equal(fs.readFileSync(fp, "utf8"), CLEAN_SETTINGS_FIXTURE);
    assert.equal(fs.readFileSync(`${fp}.dshpurge.bak`, "utf8"), CLEAN_SETTINGS_FIXTURE);
  });

  // 4. Clean file is a strict no-op (does not write disk or inject legacy API)
  await withSandbox(async ({ aiBase }) => {
    const fp = writeSettingsFile(aiBase, CLEAN_SETTINGS_FIXTURE);
    const origWriteFile = hostFs.promises.writeFile;
    let writes = 0;
    hostFs.promises.writeFile = async (...args) => {
      writes += 1;
      return origWriteFile(...args);
    };
    try {
      const report = await core.applyPatches(aiBase, [p42]);
      assert.equal(writes, 0);
      assert.equal(report[0].status, "skipped");
      assert.equal(report[0].applied, 0);
      assert.equal(report[0].drifted, 0);
      assert.equal(core.isPatchResultSoftOk(report[0], p42), true);
      assert.equal(fs.readFileSync(fp, "utf8"), CLEAN_SETTINGS_FIXTURE);
      assert.equal((await core.patchStatus(aiBase, [p42]))[42], "off");
    } finally {
      hostFs.promises.writeFile = origWriteFile;
    }
  });
});

test("patchedTargetStillPatched does not treat clean dsh-settings as still patched", async () => {
  await withSandbox(async ({ aiBase }) => {
    const fp = writeSettingsFile(aiBase, CLEAN_SETTINGS_FIXTURE, "// older clean baseline\n");
    assert.equal(core.patchedTargetStillPatched(fp, CLEAN_SETTINGS_FIXTURE, aiBase, "// older clean baseline\n"), false);
    assert.equal(core.patchedTargetStillPatched(fp, PATCHED_SETTINGS_FIXTURE, aiBase, CLEAN_SETTINGS_FIXTURE), true);

    const refreshed = core.refreshStaleBaksForUpgrade(aiBase);
    assert.equal(refreshed.includes(fp), true);
    assert.equal(fs.readFileSync(`${fp}.dshpurge.bak`, "utf8"), CLEAN_SETTINGS_FIXTURE);
  });
});

test("tallyDisplayPatches and patchStatusReady count #42 off as ready with zero pending or drifted", () => {
  const p42 = core.ALL_PATCHES.find((p) => p.id === 42);
  assert.equal(core.patchStatusReady("off", p42), true);
  assert.equal(core.patchStatusReady("pending", p42), false);

  const directTally = core.tallyDisplayPatches([{ status: "off" }]);
  assert.deepEqual(directTally, {
    applied: 0,
    pending: 0,
    unmatched: 0,
    skipped: 1,
    drifted: 0,
    total: 1,
    ready: 1,
  });

  const displayRows = core.groupPatchesForDisplay([p42], { 42: "off" }, "web");
  assert.equal(displayRows.length, 1);
  assert.equal(displayRows[0].id, 42);
  assert.equal(displayRows[0].status, "skipped");
  const groupedTally = core.tallyDisplayPatches(displayRows);
  assert.equal(groupedTally.pending, 0);
  assert.equal(groupedTally.drifted, 0);
  assert.equal(groupedTally.ready, 1);
  assert.equal(groupedTally.total, 1);
});

test("backupAll, revertAll, and restoreMissingOriginalsFromBak never preserve or re-introduce #42", async () => {
  const p42 = core.ALL_PATCHES.find((p) => p.id === 42);

  // A. backupAll + applyPatches + revertAll when .bak was initially missing on a #42-patched host
  await withSandbox(async ({ aiBase }) => {
    const fp = writeSettingsFile(aiBase, PATCHED_SETTINGS_FIXTURE);
    await core.backupAll(aiBase);
    const bakPath = `${fp}.dshpurge.bak`;
    assert.equal(fs.existsSync(bakPath), true);
    assert.equal(core.hasLegacySettingsApiPatch(fs.readFileSync(bakPath, "utf8")), false);
    assert.equal(fs.readFileSync(bakPath, "utf8"), CLEAN_SETTINGS_FIXTURE);

    const report = await core.applyPatches(aiBase, [p42]);
    assert.equal(report[0].status, "applied");
    assert.equal(fs.readFileSync(fp, "utf8"), CLEAN_SETTINGS_FIXTURE);

    const rev = await core.revertAll(aiBase);
    assert.deepEqual(rev.errors, []);
    assert.equal(core.hasLegacySettingsApiPatch(fs.readFileSync(fp, "utf8")), false);
    assert.equal(fs.readFileSync(fp, "utf8"), CLEAN_SETTINGS_FIXTURE);
  });

  // B. applyPatchesAllHosts flow (via backupAll + applyPatches) then revertAll when .bak was initially #42-polluted
  await withSandbox(async ({ aiBase }) => {
    const fp = writeSettingsFile(aiBase, PATCHED_SETTINGS_FIXTURE, PATCHED_SETTINGS_FIXTURE);
    await core.backupAll(aiBase);
    await core.applyPatches(aiBase, [p42]);
    assert.equal(fs.readFileSync(fp, "utf8"), CLEAN_SETTINGS_FIXTURE);
    assert.equal(fs.readFileSync(`${fp}.dshpurge.bak`, "utf8"), CLEAN_SETTINGS_FIXTURE);

    const rev = await core.revertAll(aiBase);
    assert.deepEqual(rev.errors, []);
    assert.equal(core.hasLegacySettingsApiPatch(fs.readFileSync(fp, "utf8")), false);
    assert.equal(fs.readFileSync(fp, "utf8"), CLEAN_SETTINGS_FIXTURE);
  });

  // C. Direct revertAll without applyPatches first: strips #42 when .bak is polluted or missing
  for (const bakInitial of [PATCHED_SETTINGS_FIXTURE, null]) {
    await withSandbox(async ({ aiBase }) => {
      const fp = writeSettingsFile(aiBase, PATCHED_SETTINGS_FIXTURE, bakInitial);
      const rev = await core.revertAll(aiBase);
      assert.deepEqual(rev.errors, []);
      assert.equal(rev.reverted.includes(fp), true);
      assert.equal(fs.readFileSync(fp, "utf8"), CLEAN_SETTINGS_FIXTURE);
      assert.equal(fs.existsSync(`${fp}.dshpurge.bak`), false);
    });
  }

  // D. restoreMissingOriginalsFromBak strips #42 when restoring from a polluted .bak
  await withSandbox(({ aiBase }) => {
    const fp = path.join(aiBase, "dsh-settings", "lib", "index.js");
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(`${fp}.dshpurge.bak`, PATCHED_SETTINGS_FIXTURE, "utf8");
    const restored = core.restoreMissingOriginalsFromBak(aiBase);
    assert.equal(restored.some((p) => path.resolve(p) === path.resolve(fp)), true);
    assert.equal(fs.readFileSync(fp, "utf8"), CLEAN_SETTINGS_FIXTURE);
    assert.equal(core.hasLegacySettingsApiPatch(fs.readFileSync(fp, "utf8")), false);
  });
});

test("stripLegacySettingsApiPatch handles regex literals with quotes, braces, and escaped slashes", () => {
  const tricky = PATCHED_SETTINGS_FIXTURE
    .replace(
      "/** Project Config schemas into forms",
      [
        "function legacyApplyPath(section, op) {",
        "\tconst a = /\"/; const b = /\\{foo/; const c = /\\//; const d = /[/}]/;",
        "\treturn { a, b, c, d, section, op };",
        "}",
        "/** Project Config schemas into forms",
      ].join("\n"),
    )
    .replace(
      "\tif (!/^[a-z][a-z0-9-]*$/.test(ns))",
      "\tconst rx1 = /\"/; const rx2 = /\\{foo/; const rx3 = /\\//; if (!/^[a-z][a-z0-9-]*$/.test(ns))",
    );
  const stripped = core.stripLegacySettingsApiPatch(tricky);
  assert.equal(stripped, CLEAN_SETTINGS_FIXTURE);
  assert.equal(core.hasLegacySettingsApiPatch(stripped), false);
});

test("stripLegacySettingsApiPatch removes block-comment #42 markers cleanly without leaving pending", async () => {
  const blockCommented = CLEAN_SETTINGS_FIXTURE
    .replace(
      "var SettingsForms = class extends Service {",
      "var SettingsForms = class extends Service { /* [dsh-purge] legacy settings api */",
    )
    .replace(
      "\t\tthis.ownerContext = ownerContext;",
      [
        "\t\t/* [dsh-purge] legacy settings api */",
        "\t\tthis.ownerContext = ownerContext; /* [dsh-purge] legacy settings api */",
      ].join("\n"),
    );

  assert.equal(core.hasLegacySettingsApiPatch(blockCommented), true);
  const stripped = core.stripLegacySettingsApiPatch(blockCommented);
  assert.equal(stripped, CLEAN_SETTINGS_FIXTURE);
  assert.equal(core.hasLegacySettingsApiPatch(stripped), false);

  const p42 = core.ALL_PATCHES.find((p) => p.id === 42);
  await withSandbox(async ({ aiBase }) => {
    const fp = writeSettingsFile(aiBase, blockCommented);
    assert.equal((await core.patchStatus(aiBase, [p42]))[42], "pending");
    const report = await core.applyPatches(aiBase, [p42]);
    assert.equal(report[0].status, "applied");
    assert.equal(fs.readFileSync(fp, "utf8"), CLEAN_SETTINGS_FIXTURE);
    assert.equal((await core.patchStatus(aiBase, [p42]))[42], "off");
  });
});
