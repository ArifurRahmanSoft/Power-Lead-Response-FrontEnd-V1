export const API_CONFIG = {
  isLive: true,
  localApiUrl: 'http://127.0.0.1:8000/api',
  //liveApiUrl: 'https://myproject-v2-2.onrender.com/api',
  liveApiUrl: 'https://power-lead-response-v1.onrender.com/api',

  get baseUrl(): string {
    return this.isLive ? this.liveApiUrl : this.localApiUrl;
  },
};
