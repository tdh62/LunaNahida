export async function droppedAudioFiles(data: DataTransfer): Promise<{ files: File[]; folder: boolean }> {
  const entries = Array.from(data.items).filter(item => item.kind === 'file').map(item => item.webkitGetAsEntry?.()).filter((entry): entry is FileSystemEntry => Boolean(entry));
  if (!entries.length) return { files: Array.from(data.files), folder: false };
  const folder = entries.some(entry => entry.isDirectory);
  const readEntry = async (entry: FileSystemEntry): Promise<File[]> => {
    if (entry.isFile) {
      const file = await new Promise<File | null>(resolve => (entry as FileSystemFileEntry).file(resolve, () => resolve(null)));
      return file ? [file] : [];
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const children: FileSystemEntry[] = [];
    while (true) {
      const batch = await new Promise<FileSystemEntry[]>(resolve => reader.readEntries(resolve, () => resolve([])));
      if (!batch.length) break;
      children.push(...batch);
    }
    return (await Promise.all(children.map(readEntry))).flat();
  };
  return { files: (await Promise.all(entries.map(readEntry))).flat(), folder };
}
