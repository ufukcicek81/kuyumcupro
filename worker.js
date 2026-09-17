export default {
  async fetch(request) {
    const h = {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json'
    };
    try {
      const r = await fetch('https://www.haremaltin.com/dashboard/altin-fiyatlari', {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/json',
          'Referer': 'https://www.haremaltin.com/',
          'X-Requested-With': 'XMLHttpRequest'
        }
      });
      const t = await r.text();
      return new Response(t, {headers: h});
    } catch (e) {
      return new Response(JSON.stringify({error: e.message}), {headers: h});
    }
  }
};
