#!/usr/bin/env node
// Read-only semantic-audit aids. Importing a bundle validates it in memory only.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

export async function auditMap(sdk, bundle, ledger) {
  const issues = [];
  const add = (code, target, detail, severity = 'incomplete') =>
    issues.push({ code, target, detail, severity });
  if (
    ledger?.format !== 'statework.map-research' ||
    ledger.version !== 1 ||
    typeof ledger.scope !== 'string' ||
    !ledger.scope.trim() ||
    !Array.isArray(ledger.sources) ||
    !Array.isArray(ledger.requirements)
  )
    throw new Error(
      'Expected a version-1 statework.map-research ledger with scope, sources and requirements.',
    );
  const service = new sdk.WorkService(new sdk.MemoryStore());
  try {
    const work = service.connect('map-audit-fresh-worker');
    await work.importBundle(bundle, { id: 'map-audit', title: 'Memory-only map audit' });
    const state = work.snapshot('map-audit');
    const items = new Map(state.items.map((i) => [i.id, i]));
    const captures = new Map((state.instructions?.sources ?? []).map((s) => [s.id, s]));
    const sourceIds = new Set();
    const requirementIds = new Set();
    if (!ledger.sources.length)
      add('NO_SOURCE_INVENTORY', 'ledger', 'No sources inventoried.', 'error');
    if (!ledger.requirements.length)
      add('NO_REQUIREMENT_INVENTORY', 'ledger', 'No requirements inventoried.', 'error');
    for (const source of ledger.sources) {
      if (!source?.id || sourceIds.has(source.id))
        add('SOURCE_ID', source?.id ?? '', 'Missing or duplicate ledger source ID.', 'error');
      sourceIds.add(source?.id);
    }
    for (const source of ledger.sources) {
      if (!source || typeof source.locator !== 'string' || !source.locator.trim()) {
        add('SOURCE_LOCATOR', source?.id ?? '', 'A source needs its actual location.', 'error');
        continue;
      }
      if (!['inspected', 'blocked', 'excluded'].includes(source.status))
        add('SOURCE_STATUS', source.id, 'Unknown source disposition.', 'error');
      if (!Array.isArray(source.children))
        add('SOURCE_CHILDREN', source.id, 'Record the discovered child source IDs.', 'error');
      else
        for (const child of source.children)
          if (!sourceIds.has(child))
            add(
              'UNACCOUNTED_LINK',
              source.id,
              `Discovered source ${child} is not inventoried.`,
              'error',
            );
      if (source.status !== 'inspected') {
        if (!source.reason?.trim())
          add(
            'SOURCE_REASON',
            source.id,
            'Blocked/excluded sources need a reason and recovery/scope basis.',
            'error',
          );
        if (source.status === 'blocked')
          add('SOURCE_BLOCKED', source.id, source.reason ?? 'Source blocked.');
      } else {
        if (source.enumerationComplete !== true)
          add(
            'SOURCE_NOT_ENUMERATED',
            source.id,
            'Full source/section/pagination enumeration is not recorded.',
          );
        if (!captures.has(source.captureId))
          add('CAPTURE_MISSING', source.id, 'Inspected source has no stored capture.', 'error');
      }
    }
    const accounted = new Set();
    for (const requirement of ledger.requirements) {
      if (!requirement?.id || requirementIds.has(requirement.id))
        add(
          'REQUIREMENT_ID',
          requirement?.id ?? '',
          'Missing or duplicate requirement ID.',
          'error',
        );
      requirementIds.add(requirement?.id);
      if (!requirement) continue;
      const source = ledger.sources.find((s) => s?.id === requirement.sourceId);
      if (!source)
        add(
          'REQUIREMENT_SOURCE',
          requirement.id,
          'Requirement source is not inventoried.',
          'error',
        );
      if (!requirement.quote?.trim() || !requirement.location?.trim())
        add(
          'REQUIREMENT_EVIDENCE',
          requirement.id,
          'Requirement needs a quote and exact location.',
          'error',
        );
      else if (source?.captureId && captures.has(source.captureId)) {
        if (!captures.get(source.captureId).content.includes(requirement.quote))
          add(
            'REQUIREMENT_QUOTE',
            requirement.id,
            'Quote is absent from its stored capture.',
            'error',
          );
      }
      if (!['mapped', 'excluded', 'deferred', 'unresolved'].includes(requirement.disposition))
        add('REQUIREMENT_DISPOSITION', requirement.id, 'Unknown requirement disposition.', 'error');
      if (!Array.isArray(requirement.itemIds)) {
        add(
          'REQUIREMENT_ITEMS',
          requirement.id,
          'Record mapped item IDs, or an empty list.',
          'error',
        );
        continue;
      }
      if (requirement.disposition === 'mapped' && !requirement.itemIds.length)
        add(
          'REQUIREMENT_UNMAPPED',
          requirement.id,
          'A mapped requirement has no work item.',
          'error',
        );
      for (const id of requirement.itemIds) {
        if (!items.has(id))
          add('REQUIREMENT_ITEM_MISSING', requirement.id, `Unknown work item ${id}.`, 'error');
        else accounted.add(id);
      }
      if (requirement.disposition !== 'mapped') {
        if (!requirement.reason?.trim())
          add(
            'REQUIREMENT_REASON',
            requirement.id,
            'Non-mapped requirements need a reason.',
            'error',
          );
        if (requirement.disposition !== 'excluded')
          add('REQUIREMENT_OPEN', requirement.id, requirement.reason ?? 'Requirement unresolved.');
      }
    }
    for (const source of captures.values()) {
      if (source.coverage !== 'complete')
        add(
          'CAPTURE_PARTIAL',
          source.id,
          `${source.coverage}: inspect omitted content and its coverage decision.`,
          'review',
        );
    }
    const tasks = state.items.filter((i) => i.kind === 'task');
    const handoffs = [];
    for (const item of state.items.filter((i) => i.status === 'done')) {
      const claims = item.extensions['statework.map/evidence']?.claims;
      const completion = Array.isArray(claims)
        ? claims.filter(
            (c) => c.field === 'status' && ['official', 'user-attested'].includes(c.basis),
          )
        : [];
      if (
        !completion.some(
          (c) =>
            c.quote?.trim() &&
            c.location?.trim() &&
            captures.get(c.sourceId)?.content.includes(c.quote),
        )
      )
        add(
          'COMPLETION_UNSUPPORTED',
          item.id,
          'Completed status needs a captured official or user-attested status claim.',
          'error',
        );
    }
    for (const task of tasks) {
      if (!accounted.has(task.id))
        add(
          'TASK_NOT_ACCOUNTED',
          task.id,
          'Task has no requirement-ledger mapping; explain its source or recovery purpose.',
          'review',
        );
      const scope = task.extensions['statework.map/scope'];
      if (
        !scope ||
        !['required', 'chosen', 'optional', 'unresolved'].includes(scope.classification)
      )
        add(
          'TASK_SCOPE',
          task.id,
          'Record whether the task is required, chosen, optional or unresolved.',
          'review',
        );
      const handoff = work.handoff('map-audit', task.id, { externalAccess: false });
      handoffs.push(handoff);
      if (task.status !== 'done' && task.status !== 'cancelled') {
        if (!handoff.packet) add('PACKET_MISSING', task.id, 'No instructions for this open task.');
        else {
          if (!handoff.packet.execution)
            add(
              'CONNECTED_PACKET_MISSING',
              task.id,
              'Legacy linear packet needs connected coverage review.',
            );
          for (const issue of handoff.blockers)
            add(`PACKET_${issue.code.toUpperCase()}`, task.id, issue.label);
          for (const step of handoff.graph)
            for (const blocker of step.blockers)
              add(`STEP_${blocker.code.toUpperCase()}`, `${task.id}/${step.id}`, blocker.label);
        }
      }
    }
    return {
      format: 'statework.map-audit',
      version: 1,
      generatedAt: new Date().toISOString(),
      scope: ledger.scope,
      bundleCanonicalSha256: createHash('sha256').update(JSON.stringify(bundle)).digest('hex'),
      structuralImport: 'passed',
      semanticCompleteness: 'requires source and worker review',
      counts: {
        sourcesKnown: ledger.sources.length,
        sourcesInspected: ledger.sources.filter(
          (s) => s.status === 'inspected' && s.enumerationComplete === true,
        ).length,
        sourcesBlocked: ledger.sources.filter((s) => s.status === 'blocked').length,
        sourcesExcluded: ledger.sources.filter((s) => s.status === 'excluded').length,
        requirementsKnown: ledger.requirements.length,
        requirementsMapped: ledger.requirements.filter((r) => r.disposition === 'mapped').length,
        requirementsExcluded: ledger.requirements.filter((r) => r.disposition === 'excluded')
          .length,
        requirementsOpen: ledger.requirements.filter((r) =>
          ['deferred', 'unresolved'].includes(r.disposition),
        ).length,
        tasks: tasks.length,
        openTasks: tasks.filter((t) => !['done', 'cancelled'].includes(t.status)).length,
        packets: handoffs.filter((h) => h.packet).length,
        reviewedPackets: handoffs.filter((h) => h.completion.reviewed).length,
        tasksWithReadyAction: handoffs.filter(
          (h) => !['done', 'cancelled'].includes(h.task.status) && h.next.length > 0,
        ).length,
        errors: issues.filter((i) => i.severity === 'error').length,
        incomplete: issues.filter((i) => i.severity === 'incomplete').length,
        review: issues.filter((i) => i.severity === 'review').length,
      },
      issues,
      handoffs,
    };
  } finally {
    service.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('--help')) {
    process.stdout.write(
      'audit-map --app <built-checkout> --bundle <bundle.json> --ledger <research.json> --out <new-report.json>\nNo live database is opened. Exit 0: no mechanical findings; 2: findings; 1: invalid input/error. Semantic review is always required.\n',
    );
    return;
  }
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (
      !['--app', '--bundle', '--ledger', '--out'].includes(args[i]) ||
      !args[i + 1] ||
      options[args[i]]
    )
      throw new Error('Use --help for the four required, unique arguments.');
    options[args[i]] = args[i + 1];
  }
  if (Object.keys(options).length !== 4) throw new Error('All four arguments are required.');
  const sdk = await import(
    pathToFileURL(join(resolve(options['--app']), 'packages/sdk/dist/index.js')).href
  );
  const report = await auditMap(
    sdk,
    JSON.parse(readFileSync(resolve(options['--bundle']), 'utf8')),
    JSON.parse(readFileSync(resolve(options['--ledger']), 'utf8')),
  );
  writeFileSync(resolve(options['--out']), JSON.stringify(report, null, 2) + '\n', {
    flag: 'wx',
    mode: 0o600,
  });
  process.stdout.write(
    JSON.stringify({ report: resolve(options['--out']), ...report.counts }) + '\n',
  );
  process.exitCode = report.issues.length ? 2 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
