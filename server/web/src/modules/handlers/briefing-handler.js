export function createBriefingHandlers(deps) {
  return {
    briefings_list: (msg) => {
      if (deps.briefing) deps.briefing.handleBriefingsList(msg);
    },
    briefing_detail: (msg) => {
      if (deps.briefing) deps.briefing.handleBriefingDetail(msg);
    },
  };
}
