// ── Team mode: state management and message routing ───────────────────────
const { ref, computed } = Vue;

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
  const { wsSend, scrollToBottom } = deps;

  // ── Reactive state ──

  /** @type {import('vue').Ref<object|null>} Current team state (TeamStateSerialized or null) */
  const teamState = ref(null);

  /** @type {import('vue').Ref<string>} 'chat' | 'team' — current input mode */
  const teamMode = ref('chat');

  /** @type {import('vue').Ref<string|null>} Currently viewed agent ID, null = dashboard */
  const activeAgentView = ref(null);

  /** @type {import('vue').Ref<object|null>} Historical team loaded for read-only viewing */
  const historicalTeam = ref(null);

  /** @type {import('vue').Ref<Array>} Teams list from server */
  const teamsList = ref([]);

  /** Per-agent message accumulator: agentId → message[] */
  const agentMessages = ref({});

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

  function launchTeam(instruction, template) {
    wsSend({ type: 'create_team', instruction, template: template || 'custom' });
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
    teamMode.value = 'chat';
    historicalTeam.value = null;
    activeAgentView.value = null;
  }

  function newTeam() {
    teamMode.value = 'team';
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
        teamMode.value = 'team';
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
        return true;
      }

      case 'team_lead_status': {
        if (!teamState.value || teamState.value.teamId !== msg.teamId) return false;
        teamState.value.leadStatus = msg.leadStatus;
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
        teamMode.value = 'team';
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
  function handleActiveTeamRestore(activeTeam) {
    if (!activeTeam) return;
    teamState.value = activeTeam;
    teamMode.value = 'team';
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

  return {
    // State
    teamState, teamMode, activeAgentView, historicalTeam, teamsList,
    agentMessages,
    // Computed
    isTeamActive, isTeamRunning, displayTeam,
    pendingTasks, activeTasks, doneTasks, failedTasks,
    // Methods
    launchTeam, dissolveTeam, viewAgent, viewDashboard,
    viewHistoricalTeam, requestTeamsList, deleteTeamById, renameTeamById,
    requestAgentHistory,
    getAgentColor, findAgent, getAgentMessages, backToChat, newTeam,
    // Message handling
    handleTeamMessage, handleTeamAgentOutput, handleActiveTeamRestore,
  };
}
