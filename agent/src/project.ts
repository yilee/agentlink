import fs from 'fs';
import path from 'path';

export interface ProjectEntry {
  name: string;
  title: string;
  description: string;
  workstreamCount: number;
  blockerCount: number;
  pendingDecisionCount: number;
  staleItemCount: number;
  lastModified?: string;
}

export interface ProjectDetail {
  name: string;
  overview: string;
  team: string;
  timeline: string;
  decisions: string;
  codePaths: string;
  missingInfo: string;
  gapAnalysis: string;
  schema: string;
  workstreams: Array<{ name: string; filename: string; content: string }>;
  blockers: string;
  pendingDecisions: string;
  staleItems: string;
}

function readText(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8').replace(/\r\n/g, '\n');
  } catch {
    return null;
  }
}

function readDir(dirPath: string): string[] {
  try {
    return fs.readdirSync(dirPath);
  } catch {
    return [];
  }
}

/** Count `## N.` numbered sections in markdown (e.g. `## 1. Title`) */
export function countNumberedSections(content: string | null): number {
  if (!content) return 0;
  const matches = content.match(/^## \d+\./gm);
  return matches ? matches.length : 0;
}

/** Extract title from README.md first heading */
function extractTitle(readmeContent: string | null, dirName: string): string {
  if (!readmeContent) return dirName;
  const match = readmeContent.match(/^#\s+(.+)/m);
  return match ? match[1].trim() : dirName;
}

/** Extract first paragraph from README.md as description */
function extractDescription(readmeContent: string | null): string {
  if (!readmeContent) return '';
  const lines = readmeContent.split('\n');
  const paragraphLines: string[] = [];
  let foundHeading = false;
  for (const line of lines) {
    if (line.startsWith('#')) {
      if (foundHeading) break;
      foundHeading = true;
      continue;
    }
    if (foundHeading && line.trim()) {
      // Stop at tables, lists, or other headings
      if (line.startsWith('|') || line.startsWith('-') || line.startsWith('*') || line.startsWith('>')) break;
      paragraphLines.push(line.trim());
    } else if (foundHeading && !line.trim() && paragraphLines.length > 0) {
      break;
    }
  }
  return paragraphLines.join(' ').slice(0, 200);
}

export async function listProjects(brainDataDir: string): Promise<ProjectEntry[]> {
  const projectsDir = path.join(brainDataDir, 'projects');
  const entries = readDir(projectsDir);

  const projects: ProjectEntry[] = [];
  for (const entry of entries) {
    const projectPath = path.join(projectsDir, entry);
    try {
      const stat = fs.statSync(projectPath);
      if (!stat.isDirectory()) continue;
    } catch {
      continue;
    }

    const readme = readText(path.join(projectPath, 'README.md'));
    const title = extractTitle(readme, entry);
    const description = extractDescription(readme);

    // Count workstreams
    const workstreamsDir = path.join(projectPath, 'project', 'workstreams');
    const workstreamFiles = readDir(workstreamsDir).filter(
      f => f.endsWith('.md') && f.toLowerCase() !== 'readme.md'
    );

    // Count cross-cutting items
    const crossCuttingDir = path.join(projectPath, 'project', 'cross_cutting');
    const blockerCount = countNumberedSections(readText(path.join(crossCuttingDir, 'blockers.md')));
    const pendingDecisionCount = countNumberedSections(readText(path.join(crossCuttingDir, 'pending_decisions.md')));
    const staleItemCount = countNumberedSections(readText(path.join(crossCuttingDir, 'stale_items.md')));

    // Get last modified from .memory_digest.yaml
    let lastModified: string | undefined;
    const digestPath = path.join(projectPath, '.memory_digest.yaml');
    const digest = readText(digestPath);
    if (digest) {
      const match = digest.match(/generated:\s*(.+)/);
      if (match) lastModified = match[1].trim();
    }

    projects.push({
      name: entry,
      title,
      description,
      workstreamCount: workstreamFiles.length,
      blockerCount,
      pendingDecisionCount,
      staleItemCount,
      lastModified,
    });
  }

  // Sort by lastModified descending (most recent first), then alphabetically
  projects.sort((a, b) => {
    if (a.lastModified && b.lastModified) return b.lastModified.localeCompare(a.lastModified);
    if (a.lastModified) return -1;
    if (b.lastModified) return 1;
    return a.name.localeCompare(b.name);
  });

  return projects;
}

export async function getProjectDetail(brainDataDir: string, projectName: string): Promise<ProjectDetail> {
  // Validate projectName to prevent path traversal
  if (!/^[\w-]+$/.test(projectName)) {
    throw new Error(`Invalid project name: ${projectName}`);
  }

  const projectDir = path.join(brainDataDir, 'projects', projectName, 'project');

  // Read main files
  const overview = readText(path.join(projectDir, 'overview.md')) || '';
  const team = readText(path.join(projectDir, 'team.md')) || '';
  const timeline = readText(path.join(projectDir, 'timeline.md')) || '';
  const decisions = readText(path.join(projectDir, 'decisions.md')) || '';
  const codePaths = readText(path.join(projectDir, 'code_paths.md')) || '';
  const missingInfo = readText(path.join(projectDir, 'missing_info.md')) || '';
  const gapAnalysis = readText(path.join(projectDir, 'gap-analysis.md')) || '';
  const schema = readText(path.join(projectDir, 'schema.md')) || '';

  // Read workstreams
  const workstreamsDir = path.join(projectDir, 'workstreams');
  const workstreamFiles = readDir(workstreamsDir).filter(
    f => f.endsWith('.md') && f.toLowerCase() !== 'readme.md'
  );
  const workstreams = workstreamFiles.map(f => ({
    name: f.replace(/\.md$/, '').replace(/_/g, ' '),
    filename: f,
    content: readText(path.join(workstreamsDir, f)) || '',
  }));

  // Read cross-cutting issues
  const crossCuttingDir = path.join(projectDir, 'cross_cutting');
  const blockers = readText(path.join(crossCuttingDir, 'blockers.md')) || '';
  const pendingDecisions = readText(path.join(crossCuttingDir, 'pending_decisions.md')) || '';
  const staleItems = readText(path.join(crossCuttingDir, 'stale_items.md')) || '';

  return {
    name: projectName,
    overview,
    team,
    timeline,
    decisions,
    codePaths,
    missingInfo,
    gapAnalysis,
    schema,
    workstreams,
    blockers,
    pendingDecisions,
    staleItems,
  };
}
