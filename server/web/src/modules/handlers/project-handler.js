export function createProjectHandlers(deps) {
  return {
    projects_list: (msg) => {
      if (deps.project) deps.project.handleProjectsList(msg);
    },
    project_detail: (msg) => {
      if (deps.project) deps.project.handleProjectDetail(msg);
    },
  };
}
