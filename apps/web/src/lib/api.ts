const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1";

export type AuthUser = {
  id: string;
  name: string | null;
  email: string;
  role: "PATIENT" | "DOCTOR" | "ADMIN";
};

export type AuthResponse = {
  success: boolean;
  message: string;
  user?: AuthUser;
  token?: string;
};

export async function authenticate(
  endpoint: "register" | "login",
  data: {
    name?: string;
    email: string;
    password: string;
  }
): Promise<AuthResponse> {
  let response: Response;

  try {
    response = await fetch(`${API_URL}/auth/${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
  } catch {
    throw new Error(
      "Cannot connect to SmartCare server. Check whether the backend is running."
    );
  }

  let result: AuthResponse;

  try {
    result = await response.json();
  } catch {
    throw new Error("Server returned an invalid response.");
  }

  if (!response.ok || !result.success) {
    throw new Error(result.message || "Authentication failed.");
  }

  if (!result.token || !result.user) {
    throw new Error("Authentication response is missing user or token.");
  }

  return result;
}