export function createRecapHandlers(deps) {
  return {
    recaps_list: (msg) => {
      if (deps.recap) deps.recap.handleRecapsList(msg);
    },
    recap_detail: (msg) => {
      if (deps.recap) deps.recap.handleRecapDetail(msg);
    },
  };
}
