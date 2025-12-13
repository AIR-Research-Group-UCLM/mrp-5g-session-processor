import axios from "axios";

export const apiClient = axios.create({
  baseURL: "/api",
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
    const isOnLoginPage = window.location.pathname === "/login";

    if (error.response?.status === 401 && !isAuthMeRequest && !isOnLoginPage) {
      window.location.href = "/login";
    }
    return Promise.reject(error);
  }
);
