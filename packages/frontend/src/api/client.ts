import axios from "axios";

const basePath = import.meta.env.VITE_BASE_PATH || "";
export const basePathNormalized = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;

export const apiClient = axios.create({
  baseURL: `${basePathNormalized}/api`,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    // Don't redirect for auth/me (it's expected to fail if not logged in)
    // Don't redirect if already on login page
    const isAuthMeRequest = error.config?.url?.includes("/auth/me");
    const loginPath = `${basePathNormalized}/login`;
    const isOnLoginPage = window.location.pathname === loginPath || window.location.pathname === "/login";

    if (error.response?.status === 401 && !isAuthMeRequest && !isOnLoginPage) {
      window.location.href = loginPath;
    }
    return Promise.reject(error);
  }
);
