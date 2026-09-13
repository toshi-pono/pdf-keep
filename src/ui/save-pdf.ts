/** Initiate the host's download flow. The host controls whether it shows a dialog. */
export function downloadPDF(file: { url: string; name: string }) {
  const link = document.createElement("a");
  link.href = file.url;
  link.download = file.name;
  link.hidden = true;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
  }
}
