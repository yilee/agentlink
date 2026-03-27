export function createDevopsHandlers(deps) {
  return {
    devops_list: (msg) => {
      if (deps.devops) deps.devops.handleDevopsList(msg);
    },
    devops_detail: (msg) => {
      if (deps.devops) deps.devops.handleDevopsDetail(msg);
    },
  };
}
