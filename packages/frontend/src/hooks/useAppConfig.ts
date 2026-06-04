import { useQuery } from "@tanstack/react-query";
import * as configApi from "@/api/config.api";

export function useAppConfig() {
  return useQuery({
    queryKey: ["app-config"],
    queryFn: () => configApi.getAppConfig(),
    staleTime: Infinity, // Runtime config doesn't change during a session
  });
}
