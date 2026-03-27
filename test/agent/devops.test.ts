import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { listDevops, getDevopsDetail } from '../../agent/src/devops.js';

const tempDir = join(tmpdir(), `agentlink-test-devops-${process.pid}`);

beforeEach(() => {
  mkdirSync(join(tempDir, 'devops', 'pull_requests'), { recursive: true });
  mkdirSync(join(tempDir, 'devops', 'work_items'), { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

const SAMPLE_PR_METADATA = `pr_number: '6503730'
title: 'Add servable ads URL sampling script'
url: https://dev.azure.com/msasg/Bing_Ads/_git/AdsAppsService/pullrequest/6503730
project: Bing_Ads
repository: AdsAppsService
source: azure_devops
message_ids:
- 20260317_000642_a256ce84
total_mentions: 3
`;

const SAMPLE_PR_DESCRIPTION = `# Pull Request #6503730: Add servable ads URL sampling script
**URL:** https://dev.azure.com/msasg/Bing_Ads/_git/AdsAppsService/pullrequest/6503730

## Status

| Field | Value |
|-------|-------|
| **Status** | completed |
| **Created By** | Kailun Shi |
| **Created Date** | 2026-03-20T10:30:00Z |
| **Source Branch** | \`user/kailunshi/eval\` |
| **Target Branch** | \`main\` |
| **Merge Status** | succeeded |

## Reviewers

- **Trupti Kulkarni**: ✅ Approved
- **Wei Zhang**: ✅ Approved
- **Pavan Kumar**: ⏸️ No vote

## Description

Some PR description here.

## Changed Files

- src/sampling.ts
`;

const SAMPLE_PR_MENTIONS = `# Mentions of PR 6503730

Discussed in 3 messages.

## Teams Chat: AdsApps Team

- 2026-03-20 10:45 — **Alice**: "Hey, can you review my PR?"
`;

const SAMPLE_WI_METADATA = `work_item_id: '6493060'
url: https://dev.azure.com/msasg/Bing_Ads/_workitems/edit/6493060
project: Bing_Ads
message_ids:
- 20260317_000642_a256ce84
total_mentions: 2
`;

const SAMPLE_WI_DESCRIPTION = `# [Task 6493060] Refactor Slideshow.helper.ts
**URL:** https://dev.azure.com/msasg/Bing_Ads/_workitems/edit/6493060

| Field | Value |
|-------|-------|
| **State** | Active |
| **Assigned To** | Kailun Shi |
| **Area Path** | Bing_Ads\\Geospatial |
| **Iteration Path** | Bing_Ads\\Sprint 45 |
| **Created Date** | 2026-03-15T09:00:00Z |
| **Priority** | 2 |
| **Severity** | N/A |

## Description

Refactor the slideshow helper module.
`;

const SAMPLE_WI_MENTIONS = `# Mentions of Work Item 6493060

Discussed in 2 messages.
`;

function createPrDir(id: string, meta: string, desc: string, mentions?: string): void {
  const dir = join(tempDir, 'devops', 'pull_requests', `pr_${id}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'metadata.yaml'), meta);
  writeFileSync(join(dir, 'description.md'), desc);
  if (mentions) writeFileSync(join(dir, 'mentions.md'), mentions);
}

function createWiDir(id: string, meta: string, desc: string, mentions?: string): void {
  const dir = join(tempDir, 'devops', 'work_items', `wi_${id}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'metadata.yaml'), meta);
  writeFileSync(join(dir, 'description.md'), desc);
  if (mentions) writeFileSync(join(dir, 'mentions.md'), mentions);
}

describe('listDevops', () => {
  it('returns empty arrays when directories do not exist', async () => {
    rmSync(tempDir, { recursive: true, force: true });
    mkdirSync(tempDir, { recursive: true });
    const result = await listDevops(tempDir);
    expect(result.pullRequests).toEqual([]);
    expect(result.workItems).toEqual([]);
    expect(result.userName).toBeTruthy();
  });

  it('returns empty arrays for empty directories', async () => {
    const result = await listDevops(tempDir);
    expect(result.pullRequests).toEqual([]);
    expect(result.workItems).toEqual([]);
  });

  it('parses a valid PR entry', async () => {
    createPrDir('6503730', SAMPLE_PR_METADATA, SAMPLE_PR_DESCRIPTION, SAMPLE_PR_MENTIONS);
    const result = await listDevops(tempDir);
    expect(result.pullRequests).toHaveLength(1);

    const pr = result.pullRequests[0];
    expect(pr.pr_number).toBe('6503730');
    expect(pr.title).toBe('Add servable ads URL sampling script');
    expect(pr.url).toContain('pullrequest/6503730');
    expect(pr.project).toBe('Bing_Ads');
    expect(pr.repository).toBe('AdsAppsService');
    expect(pr.source).toBe('azure_devops');
    expect(pr.total_mentions).toBe(3);
    expect(pr.status).toBe('completed');
    expect(pr.created_by).toBe('Kailun Shi');
    expect(pr.created_date).toContain('2026-03-20');
    expect(pr.source_branch).toContain('kailunshi/eval');
    expect(pr.target_branch).toBe('main');
    expect(pr.merge_status).toBe('succeeded');
    expect(pr.reviewers).toHaveLength(3);
    expect(pr.reviewers[0]).toEqual({ name: 'Trupti Kulkarni', vote: 'approved' });
    expect(pr.reviewers[1]).toEqual({ name: 'Wei Zhang', vote: 'approved' });
    expect(pr.reviewers[2]).toEqual({ name: 'Pavan Kumar', vote: 'no_vote' });
  });

  it('parses a valid WI entry', async () => {
    createWiDir('6493060', SAMPLE_WI_METADATA, SAMPLE_WI_DESCRIPTION, SAMPLE_WI_MENTIONS);
    const result = await listDevops(tempDir);
    expect(result.workItems).toHaveLength(1);

    const wi = result.workItems[0];
    expect(wi.work_item_id).toBe('6493060');
    expect(wi.title).toBe('Refactor Slideshow.helper.ts');
    expect(wi.url).toContain('6493060');
    expect(wi.project).toBe('Bing_Ads');
    expect(wi.total_mentions).toBe(2);
    expect(wi.state).toBe('Active');
    expect(wi.assigned_to).toBe('Kailun Shi');
    expect(wi.priority).toBe('2');
    expect(wi.severity).toBe('N/A');
    expect(wi.area_path).toContain('Geospatial');
    expect(wi.created_date).toContain('2026-03-15');
    expect(wi.work_item_type).toBe('Task');
  });

  it('handles PR with null title in metadata — uses description H1', async () => {
    const meta = SAMPLE_PR_METADATA.replace("title: 'Add servable ads URL sampling script'", 'title: null');
    createPrDir('123', meta, SAMPLE_PR_DESCRIPTION);
    const result = await listDevops(tempDir);
    expect(result.pullRequests[0].title).toBe('Add servable ads URL sampling script');
  });

  it('handles WI with Bug type in H1', async () => {
    const desc = `# [Bug 999] Critical crash on startup
**URL:** https://example.com

| Field | Value |
|-------|-------|
| **State** | New |
| **Assigned To** | Alice |
| **Priority** | 1 |
| **Severity** | 1 - Critical |
| **Area Path** | Project\\Bugs |
| **Created Date** | 2026-03-20T00:00:00Z |
`;
    createWiDir('999', SAMPLE_WI_METADATA.replace("'6493060'", "'999'"), desc);
    const result = await listDevops(tempDir);
    expect(result.workItems[0].title).toBe('Critical crash on startup');
    expect(result.workItems[0].work_item_type).toBe('Bug');
    expect(result.workItems[0].priority).toBe('1');
  });

  it('sorts PRs by created_date descending', async () => {
    const meta1 = SAMPLE_PR_METADATA.replace("'6503730'", "'1'");
    const desc1 = SAMPLE_PR_DESCRIPTION.replace('2026-03-20T10:30:00Z', '2026-03-18T00:00:00Z');
    createPrDir('1', meta1, desc1);

    const meta2 = SAMPLE_PR_METADATA.replace("'6503730'", "'2'");
    const desc2 = SAMPLE_PR_DESCRIPTION.replace('2026-03-20T10:30:00Z', '2026-03-22T00:00:00Z');
    createPrDir('2', meta2, desc2);

    const result = await listDevops(tempDir);
    expect(result.pullRequests[0].pr_number).toBe('2');
    expect(result.pullRequests[1].pr_number).toBe('1');
  });

  it('sorts WIs by priority ascending then created_date descending', async () => {
    const meta1 = SAMPLE_WI_METADATA.replace("'6493060'", "'1'");
    const desc1 = SAMPLE_WI_DESCRIPTION.replace('Priority** | 2', 'Priority** | 3').replace('2026-03-15T09:00:00Z', '2026-03-20T00:00:00Z');
    createWiDir('1', meta1, desc1);

    const meta2 = SAMPLE_WI_METADATA.replace("'6493060'", "'2'");
    const desc2 = SAMPLE_WI_DESCRIPTION.replace('2026-03-15T09:00:00Z', '2026-03-10T00:00:00Z');
    createWiDir('2', meta2, desc2);

    const meta3 = SAMPLE_WI_METADATA.replace("'6493060'", "'3'");
    const desc3 = SAMPLE_WI_DESCRIPTION.replace('Priority** | 2', 'Priority** | 1').replace('2026-03-15T09:00:00Z', '2026-03-22T00:00:00Z');
    createWiDir('3', meta3, desc3);

    const result = await listDevops(tempDir);
    // P1 first, then P2s by date desc
    expect(result.workItems[0].work_item_id).toBe('3');  // P1
    expect(result.workItems[1].work_item_id).toBe('2');   // P2, older
    expect(result.workItems[2].work_item_id).toBe('1');   // P3
  });

  it('skips directories that do not start with pr_ or wi_', async () => {
    mkdirSync(join(tempDir, 'devops', 'pull_requests', 'not_a_pr'), { recursive: true });
    createPrDir('100', SAMPLE_PR_METADATA, SAMPLE_PR_DESCRIPTION);
    const result = await listDevops(tempDir);
    expect(result.pullRequests).toHaveLength(1);
  });

  it('continues parsing when one PR dir is corrupted', async () => {
    createPrDir('good', SAMPLE_PR_METADATA, SAMPLE_PR_DESCRIPTION);
    // Create a corrupted dir (no metadata.yaml)
    mkdirSync(join(tempDir, 'devops', 'pull_requests', 'pr_bad'), { recursive: true });
    const result = await listDevops(tempDir);
    expect(result.pullRequests).toHaveLength(1);
  });

  it('handles PR with missing description.md gracefully', async () => {
    const dir = join(tempDir, 'devops', 'pull_requests', 'pr_nodesc');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'metadata.yaml'), SAMPLE_PR_METADATA);
    const result = await listDevops(tempDir);
    expect(result.pullRequests).toHaveLength(1);
    expect(result.pullRequests[0].status).toBe('active');
    expect(result.pullRequests[0].reviewers).toEqual([]);
  });

  it('provides userName from OS', async () => {
    const result = await listDevops(tempDir);
    expect(typeof result.userName).toBe('string');
    expect(result.userName.length).toBeGreaterThan(0);
  });
});

describe('getDevopsDetail', () => {
  it('reads PR description + mentions', async () => {
    createPrDir('6503730', SAMPLE_PR_METADATA, SAMPLE_PR_DESCRIPTION, SAMPLE_PR_MENTIONS);
    const detail = await getDevopsDetail(tempDir, 'pr', '6503730');
    expect(detail.entityType).toBe('pr');
    expect(detail.entityId).toBe('6503730');
    expect(detail.description).toContain('Pull Request #6503730');
    expect(detail.mentions).toContain('Mentions of PR 6503730');
  });

  it('reads WI description + mentions', async () => {
    createWiDir('6493060', SAMPLE_WI_METADATA, SAMPLE_WI_DESCRIPTION, SAMPLE_WI_MENTIONS);
    const detail = await getDevopsDetail(tempDir, 'wi', '6493060');
    expect(detail.entityType).toBe('wi');
    expect(detail.entityId).toBe('6493060');
    expect(detail.description).toContain('Task 6493060');
    expect(detail.mentions).toContain('Mentions of Work Item');
  });

  it('returns description only when mentions.md missing', async () => {
    createPrDir('nomention', SAMPLE_PR_METADATA, SAMPLE_PR_DESCRIPTION);
    const detail = await getDevopsDetail(tempDir, 'pr', 'nomention');
    expect(detail.description).toBeTruthy();
    expect(detail.mentions).toBe('');
  });

  it('throws for non-existent entity', async () => {
    await expect(getDevopsDetail(tempDir, 'pr', '999999')).rejects.toThrow('not found');
  });

  it('rejects invalid entity ID (path traversal prevention)', async () => {
    await expect(getDevopsDetail(tempDir, 'pr', '../../../etc/passwd')).rejects.toThrow('Invalid entity ID');
    await expect(getDevopsDetail(tempDir, 'wi', '123/../../..')).rejects.toThrow('Invalid entity ID');
  });
});
