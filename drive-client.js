export function createDriveClient(supabase, endpoint, apiKey) {
  async function send(query, options = {}) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('ログインし直してください');
    const response = await fetch(`${endpoint}${query}`, {
      ...options,
      headers: { ...options.headers, authorization: `Bearer ${session.access_token}`, apikey: apiKey }
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || 'Googleドライブに接続できませんでした');
    }
    return response;
  }
  return {
    async upload(attachment) {
      return (await send('', { method: 'POST', headers: { 'content-type': attachment.file.type, 'x-file-size': String(attachment.file.size) }, body: attachment.file })).json();
    },
    async read(path) {
      const response = await send(`?id=${encodeURIComponent(path.slice('drive:'.length))}`);
      return URL.createObjectURL(await response.blob());
    }
  };
}
