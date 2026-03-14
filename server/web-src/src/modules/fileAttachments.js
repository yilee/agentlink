// ── File attachment handling ──────────────────────────────────────────────────

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILES = 5;
const ACCEPTED_EXTENSIONS = [
  '.pdf', '.json', '.md', '.py', '.js', '.ts', '.tsx', '.jsx', '.css',
  '.html', '.xml', '.yaml', '.yml', '.toml', '.sh', '.sql', '.csv',
  '.c', '.cpp', '.h', '.hpp', '.java', '.go', '.rs', '.rb', '.php',
  '.swift', '.kt', '.scala', '.r', '.m', '.vue', '.svelte', '.txt',
  '.log', '.cfg', '.ini', '.env', '.gitignore', '.dockerfile',
];

function isAcceptedFile(file) {
  if (file.type.startsWith('image/')) return true;
  if (file.type.startsWith('text/')) return true;
  const ext = '.' + file.name.split('.').pop().toLowerCase();
  return ACCEPTED_EXTENSIONS.includes(ext);
}

export function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Creates file attachment handlers bound to Vue reactive state.
 * @param {import('vue').Ref} attachments - ref([])
 * @param {import('vue').Ref} fileInputRef - ref(null)
 * @param {import('vue').Ref} dragOver - ref(false)
 */
export function createFileAttachments(attachments, fileInputRef, dragOver) {

  async function addFiles(fileList) {
    const currentCount = attachments.value.length;
    const remaining = MAX_FILES - currentCount;
    if (remaining <= 0) return;

    const files = Array.from(fileList).slice(0, remaining);
    for (const file of files) {
      if (!isAcceptedFile(file)) continue;
      if (file.size > MAX_FILE_SIZE) continue;
      if (attachments.value.some(a => a.name === file.name && a.size === file.size)) continue;

      const data = await readFileAsBase64(file);
      const isImage = file.type.startsWith('image/');
      let thumbUrl = null;
      if (isImage) {
        thumbUrl = URL.createObjectURL(file);
      }
      attachments.value.push({
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
        data,
        isImage,
        thumbUrl,
      });
    }
  }

  function removeAttachment(index) {
    const att = attachments.value[index];
    if (att.thumbUrl) URL.revokeObjectURL(att.thumbUrl);
    attachments.value.splice(index, 1);
  }

  function triggerFileInput() {
    if (fileInputRef.value) fileInputRef.value.click();
  }

  function handleFileSelect(e) {
    if (e.target.files) addFiles(e.target.files);
    e.target.value = '';
  }

  function handleDragOver(e) {
    e.preventDefault();
    dragOver.value = true;
  }

  function handleDragLeave(e) {
    e.preventDefault();
    dragOver.value = false;
  }

  function handleDrop(e) {
    e.preventDefault();
    dragOver.value = false;
    if (e.dataTransfer?.files) addFiles(e.dataTransfer.files);
  }

  function handlePaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files = [];
    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      addFiles(files);
    }
  }

  return {
    addFiles, removeAttachment, triggerFileInput, handleFileSelect,
    handleDragOver, handleDragLeave, handleDrop, handlePaste,
  };
}
