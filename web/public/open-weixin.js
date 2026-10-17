window.addEventListener('load', () => {
  const link = document.getElementById('open-weixin');
  if (!link) return;
  try {
    window.location.replace(link.href);
  } catch {
    // The HTML link remains available if the browser blocks the automatic launch.
  }
}, { once: true });
