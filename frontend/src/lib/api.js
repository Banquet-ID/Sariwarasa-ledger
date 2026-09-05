import axios from "axios";

export const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Auth murni via Bearer token (localStorage); cookie tidak dipakai.
// withCredentials=false agar CORS lintas domain (Vercel frontend ↔ backend) tidak diblokir browser.
const api = axios.create({ baseURL: API, withCredentials: false });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("sw_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export const fileUrl = (path) => {
  const token = localStorage.getItem("sw_token");
  return `${API}/files/${path}${token ? `?auth=${token}` : ""}`;
};

export default api;
