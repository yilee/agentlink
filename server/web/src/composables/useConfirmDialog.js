import { ref } from 'vue';

// Module-level state — singleton shared across all callers
const confirmOpen = ref(false);
const confirmTitle = ref('');
const confirmMessage = ref('');
const confirmItemName = ref('');
const confirmWarning = ref('');
const confirmButtonText = ref('');

let _onConfirm = null;

export function useConfirmDialog() {
  /**
   * Show a confirmation dialog.
   * @param {object} opts
   * @param {string} opts.title - Dialog header text
   * @param {string} opts.message - Body text
   * @param {string} [opts.itemName] - Highlighted item name (e.g. session title, file name)
   * @param {string} [opts.warning] - Small warning text (e.g. "This action cannot be undone.")
   * @param {string} [opts.confirmText] - Confirm button label (default: "Delete")
   * @param {Function} opts.onConfirm - Called when user clicks confirm
   */
  function showConfirm({ title, message, itemName = '', warning = '', confirmText = '', onConfirm }) {
    confirmTitle.value = title;
    confirmMessage.value = message;
    confirmItemName.value = itemName;
    confirmWarning.value = warning;
    confirmButtonText.value = confirmText;
    _onConfirm = onConfirm;
    confirmOpen.value = true;
  }

  function doConfirm() {
    confirmOpen.value = false;
    if (_onConfirm) _onConfirm();
    _onConfirm = null;
  }

  function doCancel() {
    confirmOpen.value = false;
    _onConfirm = null;
  }

  return {
    confirmOpen,
    confirmTitle,
    confirmMessage,
    confirmItemName,
    confirmWarning,
    confirmButtonText,
    showConfirm,
    doConfirm,
    doCancel,
  };
}
