// ── Team mode: state management and message routing ───────────────────────
import { ref, computed } from 'vue';
import { TEMPLATES, TEMPLATE_KEYS, buildFullLeadPrompt } from './teamTemplates.js';

const MAX_FEED_ENTRIES = 200;

// Color palette (matches agent/src/team.ts AGENT_COLORS)
const AGENT_COLORS = [
  '#EF4444', '#EAB308', '#3B82F6', '#10B981', '#8B5CF6',
  '#F97316', '#EC4899', '#06B6D4', '#84CC16', '#6366F1',
];

/**
 * Creates the team mode controller.
 * @param {object} deps
 * @param {Function} deps.wsSend
 * @param {Function} deps.scrollToBottom
 */
export function createTeam(deps) {
  const { wsSend, scrollToBottom, loadingTeams } = deps;

  // ── Reactive state ──

  /** @type {import('vue').Ref<object|null>} Current team state (TeamStateSerialized or null) */
  const teamState = ref(null);

  /** @type {import('vue').Ref<string>} 'chat' | 'team' | 'loop' — current view mode */
  const viewMode = ref('chat');

  /** @type {import('vue').Ref<string|null>} Currently viewed agent ID, null = dashboard */
  const activeAgentView = ref(null);

  /** @type {import('vue').Ref<object|null>} Historical team loaded for read-only viewing */
  const historicalTeam = ref(null);

  /** @type {import('vue').Ref<Array>} Teams list from server */
  const teamsList = ref([]);

  /** Per-agent message accumulator: agentId → message[] */
  const agentMessages = ref({});

  // --- Team panel refs (moved from store.js) ---
  const renamingTeamId = ref(null);
  const renameTeamText = ref('');
  const deleteTeamConfirmOpen = ref(false);
  const deleteTeamConfirmTitle = ref('');
  const pendingDeleteTeamId = ref(null);
  const teamInstruction = ref('');
  const selectedTemplate = ref('custom');
  const editedLeadPrompt = ref(TEMPLATES.custom.leadPrompt);
  const leadPromptExpanded = ref(false);
  const kanbanExpanded = ref(false);
  const instructionExpanded = ref(false);


  /** Per-agent message ID counter */
  let agentMsgIdCounter = 0;

  // ── Computed ──

  const isTeamActive = computed(() => teamState.value !== null && teamState.value.status !== 'completed' && teamState.value.status !== 'failed');
  const isTeamRunning = computed(() => teamState.value !== null && (teamState.value.status === 'running' || teamState.value.status === 'planning' || teamState.value.status === 'summarizing'));

  /** The team being displayed: active or historical */
  const displayTeam = computed(() => historicalTeam.value || teamState.value);

  const pendingTasks = computed(() => {
    const t = displayTeam.value;
    if (!t) return [];
    return t.tasks.filter(task => task.status === 'pending');
  });
  const activeTasks = computed(() => {
    const t = displayTeam.value;
    if (!t) return [];
    return t.tasks.filter(task => task.status === 'active');
  });
  const doneTasks = computed(() => {
    const t = displayTeam.value;
    if (!t) return [];
    return t.tasks.filter(task => task.status === 'done');
  });
  const failedTasks = computed(() => {
    const t = displayTeam.value;
    if (!t) return [];
    return t.tasks.filter(task => task.status === 'failed');
  });

  // ── Methods ──

  /** Sync active team's status into the sidebar teamsList entry. */
  function syncTeamsListStatus() {
    if (!teamState.value) return;
    const item = teamsList.value.find(t => t.teamId === teamState.value.teamId);
    if (item) item.status = teamState.value.status;
  }

  function launchTeam(instruction, leadPrompt, agents) {
    wsSend({ type: 'create_team', instruction, leadPrompt, agents });
  }

  function dissolveTeam() {
    wsSend({ type: 'dissolve_team' });
  }

  function viewAgent(agentId) {
    activeAgentView.value = agentId;
  }

  function viewDashboard() {
    activeAgentView.value = null;
  }

  function viewHistoricalTeam(teamId) {
    wsSend({ type: 'get_team', teamId });
  }

  function requestTeamsList() {
    if (loadingTeams) loadingTeams.value = true;
    wsSend({ type: 'list_teams' });
  }

  function deleteTeamById(teamId) {
    wsSend({ type: 'delete_team', teamId });
  }

  function renameTeamById(teamId, newTitle) {
    wsSend({ type: 'rename_team', teamId, newTitle });
  }

  function requestAgentHistory(teamId, agentId) {
    wsSend({ type: 'get_team_agent_history', teamId, agentId });
  }

  function getAgentColor(agentId) {
    if (agentId === 'lead') return '#A78BFA'; // purple for lead
    const t = displayTeam.value;
    if (!t || !t.agents) return AGENT_COLORS[0];
    const idx = t.agents.findIndex(a => a.id === agentId);
    return idx >= 0 ? AGENT_COLORS[idx % AGENT_COLORS.length] : AGENT_COLORS[0];
  }

  function findAgent(agentId) {
    if (agentId === 'lead') return { id: 'lead', name: 'Lead', color: '#A78BFA', status: 'working' };
    const t = displayTeam.value;
    if (!t || !t.agents) return null;
    return t.agents.find(a => a.id === agentId) || null;
  }

  function getAgentMessages(agentId) {
    return agentMessages.value[agentId] || [];
  }

  function backToChat() {
    viewMode.value = 'chat';
    historicalTeam.value = null;
    activeAgentView.value = null;
  }

  function newTeam() {
    viewMode.value = 'team';
    historicalTeam.value = null;
    activeAgentView.value = null;
    // If completed team is still in teamState, clear it so create panel shows
    if (teamState.value && (teamState.value.status === 'completed' || teamState.value.status === 'failed')) {
      teamState.value = null;
    }
    requestTeamsList();
  }

  // ── Message routing ──

  /**
   * Handle incoming team-related messages from the WebSocket.
   * Returns true if the message was consumed (should not be processed further).
   */
  function handleTeamMessage(msg) {
    switch (msg.type) {
      case 'team_created':
        teamState.value = msg.team;
        viewMode.value = 'team';
        historicalTeam.value = null;
        activeAgentView.value = null;
        agentMessages.value = {};
        agentMsgIdCounter = 0;
        // Initialize lead message list
        agentMessages.value['lead'] = [];
        // Initialize agent message lists
        if (msg.team.agents) {
          for (const agent of msg.team.agents) {
            agentMessages.value[agent.id] = [];
          }
        }
        return true;

      case 'team_agent_status': {
        if (!teamState.value || teamState.value.teamId !== msg.teamId) return false;
        const agent = msg.agent;
        const existing = teamState.value.agents.find(a => a.id === agent.id);
        if (existing) {
          existing.status = agent.status;
          existing.taskId = agent.taskId;
        } else {
          // New agent joined
          teamState.value.agents.push(agent);
          if (!agentMessages.value[agent.id]) {
            agentMessages.value[agent.id] = [];
          }
        }
        // Update team status to running when first subagent appears
        if (teamState.value.status === 'planning') {
          teamState.value.status = 'running';
          syncTeamsListStatus();
        }
        return true;
      }

      case 'team_task_update': {
        if (!teamState.value || teamState.value.teamId !== msg.teamId) return false;
        const task = msg.task;
        const idx = teamState.value.tasks.findIndex(t => t.id === task.id);
        if (idx >= 0) {
          teamState.value.tasks[idx] = task;
        } else {
          teamState.value.tasks.push(task);
        }
        return true;
      }

      case 'team_feed': {
        if (!teamState.value || teamState.value.teamId !== msg.teamId) return false;
        teamState.value.feed.push(msg.entry);
        // Cap feed entries
        if (teamState.value.feed.length > MAX_FEED_ENTRIES) {
          teamState.value.feed = teamState.value.feed.slice(-MAX_FEED_ENTRIES);
        }
        return true;
      }

      case 'team_completed': {
        if (!teamState.value || teamState.value.teamId !== msg.teamId) return false;
        // Update with final state from server
        teamState.value = msg.team;
        syncTeamsListStatus();
        return true;
      }

      case 'team_lead_status': {
        if (!teamState.value || teamState.value.teamId !== msg.teamId) return false;
        teamState.value.leadStatus = msg.leadStatus;
        if (msg.teamStatus) {
          teamState.value.status = msg.teamStatus;
          syncTeamsListStatus();
        }
        return true;
      }

      case 'teams_list':
        teamsList.value = msg.teams || [];
        return true;

      case 'team_deleted':
        teamsList.value = teamsList.value.filter(t => t.teamId !== msg.teamId);
        // If viewing the deleted team, go back
        if (historicalTeam.value && historicalTeam.value.teamId === msg.teamId) {
          historicalTeam.value = null;
        }
        return true;

      case 'team_renamed': {
        const item = teamsList.value.find(t => t.teamId === msg.teamId);
        if (item) item.title = msg.newTitle;
        // Update historical view if showing this team
        if (historicalTeam.value && historicalTeam.value.teamId === msg.teamId) {
          historicalTeam.value.title = msg.newTitle;
        }
        // Update active team if it's the same
        if (teamState.value && teamState.value.teamId === msg.teamId) {
          teamState.value.title = msg.newTitle;
        }
        return true;
      }

      case 'team_detail':
        historicalTeam.value = msg.team;
        viewMode.value = 'team';
        activeAgentView.value = null;
        return true;

      case 'team_agent_history': {
        if (msg.agentId) {
          if (msg.messages && msg.messages.length > 0) {
            // Default expand tool messages in history view
            for (const m of msg.messages) {
              if (m.role === 'tool' && m.expanded === undefined) m.expanded = true;
            }
            agentMessages.value[msg.agentId] = msg.messages;
          } else {
            agentMessages.value[msg.agentId] = [];
          }
        }
        return true;
      }

      default:
        return false;
    }
  }

  /**
   * Handle claude_output messages tagged with teamId + agentRole.
   * Accumulates per-agent messages for agent detail view.
   * Returns true if consumed.
   */
  function handleTeamAgentOutput(msg) {
    if (!msg.teamId || !msg.agentRole) return false;
    if (!teamState.value || teamState.value.teamId !== msg.teamId) return false;

    const agentId = msg.agentRole;
    if (!agentMessages.value[agentId]) {
      agentMessages.value[agentId] = [];
    }
    const msgs = agentMessages.value[agentId];
    const data = msg.data;
    if (!data) return true;

    if (data.type === 'content_block_delta' && data.delta) {
      // Append text to last assistant message (or create new one)
      const last = msgs.length > 0 ? msgs[msgs.length - 1] : null;
      if (last && last.role === 'assistant' && last.isStreaming) {
        last.content += data.delta;
      } else {
        msgs.push({
          id: ++agentMsgIdCounter, role: 'assistant',
          content: data.delta, isStreaming: true, timestamp: Date.now(),
        });
      }
    } else if (data.type === 'tool_use' && data.tools) {
      // Finalize streaming message
      const last = msgs.length > 0 ? msgs[msgs.length - 1] : null;
      if (last && last.role === 'assistant' && last.isStreaming) {
        last.isStreaming = false;
      }
      for (const tool of data.tools) {
        msgs.push({
          id: ++agentMsgIdCounter, role: 'tool',
          toolId: tool.id, toolName: tool.name || 'unknown',
          toolInput: tool.input ? JSON.stringify(tool.input, null, 2) : '',
          hasResult: false, expanded: true, timestamp: Date.now(),
        });
      }
    } else if (data.type === 'user' && data.tool_use_result) {
      const result = data.tool_use_result;
      const results = Array.isArray(result) ? result : [result];
      for (const r of results) {
        const toolMsg = msgs.find(m => m.role === 'tool' && m.toolId === r.tool_use_id);
        if (toolMsg) {
          toolMsg.toolOutput = typeof r.content === 'string'
            ? r.content : JSON.stringify(r.content, null, 2);
          toolMsg.hasResult = true;
        }
      }
    }

    return true;
  }

  /**
   * Handle active_conversations response that includes activeTeam.
   * Called on initial connect + reconnect to restore team state.
   */
  function handleActiveTeamRestore(activeTeam, currentWorkDir) {
    if (!activeTeam) return;
    // Skip if the active team belongs to a different workdir
    if (currentWorkDir && activeTeam.workDir && activeTeam.workDir !== currentWorkDir) return;

    const wasAlreadyLoaded = teamState.value !== null;
    teamState.value = activeTeam;
    // Only switch to team view on first restore (initial connect / reconnect),
    // not on idle-check polls — otherwise the user gets yanked out of chat.
    if (!wasAlreadyLoaded) {
      viewMode.value = 'team';
    }
    // Re-initialize agent message lists (messages lost on reconnect)
    if (!agentMessages.value['lead']) {
      agentMessages.value['lead'] = [];
    }
    if (activeTeam.agents) {
      for (const agent of activeTeam.agents) {
        if (!agentMessages.value[agent.id]) {
          agentMessages.value[agent.id] = [];
        }
      }
    }
  }


  // --- Team panel methods (moved from store.js) ---
    const teamExamples = [
    {
      icon: '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V9h2v2zm0-4H8V5h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8v10zm-2-8h-2v2h2v-2zm0 4h-2v2h2v-2z"/></svg>',
      title: 'Full-stack App',
      template: 'full-stack',
      text: 'Build a single-page calculator app: one agent creates the HTML/CSS UI, one implements the JavaScript logic, and one writes tests.',
    },
    {
      icon: '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/></svg>',
      title: 'Research',
      template: 'research',
      text: 'Research this project\'s architecture: one agent analyzes the backend structure, one maps the frontend components, and one reviews the build and deployment pipeline. Produce a unified architecture report.',
    },
    {
      icon: '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>',
      title: '\u4EE3\u7801\u5BA1\u67E5',
      template: 'code-review',
      text: '\u5BA1\u67E5\u5F53\u524D\u9879\u76EE\u7684\u4EE3\u7801\u8D28\u91CF\u3001\u5B89\u5168\u6F0F\u6D1E\u548C\u6D4B\u8BD5\u8986\u76D6\u7387\uFF0C\u6309\u4E25\u91CD\u7A0B\u5EA6\u751F\u6210\u5206\u7EA7\u62A5\u544A\uFF0C\u5E76\u7ED9\u51FA\u4FEE\u590D\u5EFA\u8BAE\u3002',
    },
    {
      icon: '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>',
      title: '\u6280\u672F\u6587\u6863',
      template: 'content',
      text: '\u4E3A\u5F53\u524D\u9879\u76EE\u7F16\u5199\u4E00\u4EFD\u5B8C\u6574\u7684\u6280\u672F\u6587\u6863\uFF1A\u5148\u8C03\u7814\u9879\u76EE\u7ED3\u6784\u548C\u6838\u5FC3\u6A21\u5757\uFF0C\u7136\u540E\u64B0\u5199\u5305\u542B\u67B6\u6784\u6982\u89C8\u3001API \u53C2\u8003\u548C\u4F7F\u7528\u6307\u5357\u7684\u6587\u6863\uFF0C\u6700\u540E\u6821\u5BA1\u786E\u4FDD\u51C6\u786E\u6027\u548C\u53EF\u8BFB\u6027\u3002',
    },
  ];

  function startTeamRename(tm) {
    renamingTeamId.value = tm.teamId;
    renameTeamText.value = tm.title || '';
  }

  function confirmTeamRename() {
    const tid = renamingTeamId.value;
    const title = renameTeamText.value.trim();
    if (!tid || !title) { renamingTeamId.value = null; renameTeamText.value = ''; return; }
    renameTeamById(tid, title);
    renamingTeamId.value = null;
    renameTeamText.value = '';
  }

  function cancelTeamRename() {
    renamingTeamId.value = null;
    renameTeamText.value = '';
  }

  function requestDeleteTeam(tm) {
    pendingDeleteTeamId.value = tm.teamId;
    deleteTeamConfirmTitle.value = tm.title || tm.teamId.slice(0, 8);
    deleteTeamConfirmOpen.value = true;
  }

  function confirmDeleteTeam() {
    if (!pendingDeleteTeamId.value) return;
    deleteTeamById(pendingDeleteTeamId.value);
    deleteTeamConfirmOpen.value = false;
    pendingDeleteTeamId.value = null;
  }

  function cancelDeleteTeam() {
    deleteTeamConfirmOpen.value = false;
    pendingDeleteTeamId.value = null;
  }

  function onTemplateChange(key) {
    selectedTemplate.value = key;
    editedLeadPrompt.value = TEMPLATES[key].leadPrompt;
  }

  function resetLeadPrompt() {
    editedLeadPrompt.value = TEMPLATES[selectedTemplate.value].leadPrompt;
  }

  function leadPromptPreview() {
    const text = editedLeadPrompt.value || '';
    return text.length > 80 ? text.slice(0, 80) + '...' : text;
  }

  function launchTeamFromPanel() {
    const inst = teamInstruction.value.trim();
    if (!inst) return;
    const tplKey = selectedTemplate.value;
    const tpl = TEMPLATES[tplKey];
    const agents = tpl.agents;
    const leadPrompt = buildFullLeadPrompt(editedLeadPrompt.value, agents, inst);
    launchTeam(inst, leadPrompt, agents);
    teamInstruction.value = '';
    // Reset template state for next time
    selectedTemplate.value = 'custom';
    editedLeadPrompt.value = TEMPLATES.custom.leadPrompt;
    leadPromptExpanded.value = false;
  }

  function formatTeamTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function getTaskAgent(task) {
    const assignee = task.assignee || task.assignedTo;
    if (!assignee) return null;
    return findAgent(assignee);
  }

  function viewAgentWithHistory(agentId) {
    viewAgent(agentId);
    // For historical teams, request agent conversation history from server
    if (historicalTeam.value && historicalTeam.value.teamId) {
      requestAgentHistory(historicalTeam.value.teamId, agentId);
    }
  }

  function getLatestAgentActivity(agentId) {
    // Find the latest feed entry for this agent
    const t = displayTeam.value;
    if (!t || !t.feed) return '';
    for (let i = t.feed.length - 1; i >= 0; i--) {
      const entry = t.feed[i];
      if (entry.agentId === agentId && entry.type === 'tool_call') {
        // Strip agent name prefix since it's already shown on the card
        const agent = findAgent(agentId);
        if (agent && agent.name && entry.content.startsWith(agent.name)) {
          return entry.content.slice(agent.name.length).trimStart();
        }
        return entry.content;
      }
    }
    return '';
  }

  return {
    // State
    teamState, viewMode, activeAgentView, historicalTeam, teamsList,
    agentMessages,
    // Panel state
    teamInstruction, selectedTemplate, editedLeadPrompt,
    leadPromptExpanded, kanbanExpanded, instructionExpanded,
    // Rename/delete state
    renamingTeamId, renameTeamText,
    deleteTeamConfirmOpen, deleteTeamConfirmTitle, pendingDeleteTeamId,
    // Computed
    isTeamActive, isTeamRunning, displayTeam,
    pendingTasks, activeTasks, doneTasks, failedTasks,
    // Constants
    TEMPLATES, TEMPLATE_KEYS, teamExamples,
    // Methods
    launchTeam, dissolveTeam, viewAgent, viewDashboard,
    viewHistoricalTeam, requestTeamsList, deleteTeamById, renameTeamById,
    requestAgentHistory,
    getAgentColor, findAgent, getAgentMessages, backToChat, newTeam,
    // Rename/delete methods
    startTeamRename, confirmTeamRename, cancelTeamRename,
    requestDeleteTeam, confirmDeleteTeam, cancelDeleteTeam,
    // Template methods
    onTemplateChange, resetLeadPrompt, leadPromptPreview, launchTeamFromPanel,
    // Utility methods
    formatTeamTime, getTaskAgent, viewAgentWithHistory, getLatestAgentActivity,
    // Message handling
    handleTeamMessage, handleTeamAgentOutput, handleActiveTeamRestore,
  };
}
