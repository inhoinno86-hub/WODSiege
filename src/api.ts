import { Capacitor } from "@capacitor/core";

const DEFAULT_URL = Capacitor.isNativePlatform() ? "http://localhost:8787" : "";
export function serverUrl() {
  return localStorage.getItem("wodsiege-server") ?? DEFAULT_URL;
}
export function saveServerUrl(value: string) {
  const clean = value.trim().replace(/\/+$/, "");
  if (clean && !/^https?:\/\//.test(clean))
    throw new Error(
      "http:// 또는 https://로 시작하는 서버 주소를 입력해 주세요.",
    );
  if (clean) {
    const url = new URL(clean);
    if (
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error("계정 정보나 경로가 없는 서버 주소를 입력해 주세요.");
  }
  localStorage.setItem("wodsiege-server", clean || DEFAULT_URL);
  sessionStorage.removeItem("wodsiege-token");
}
export function token() {
  return sessionStorage.getItem("wodsiege-token");
}
export function setToken(value?: string) {
  if (value) sessionStorage.setItem("wodsiege-token", value);
  else sessionStorage.removeItem("wodsiege-token");
}
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`${serverUrl()}/api${path}`, {
      method: body === undefined ? "GET" : "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401) setToken();
      throw new Error(
        data.error ?? "요청을 처리하지 못했습니다. 다시 시도해 주세요.",
      );
    }
    return data as T;
  } catch (error) {
    if (
      error instanceof TypeError ||
      (error instanceof DOMException && error.name === "AbortError")
    )
      throw new Error(
        "서버에 연결할 수 없습니다. 서버 실행 상태와 연결 주소를 확인하고 다시 시도해 주세요.",
      );
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
export function uploadVideo(
  matchId: string,
  file: File,
  progress: (value: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${serverUrl()}/api/matches/${matchId}/video`);
    xhr.setRequestHeader("Authorization", `Bearer ${token()}`);
    xhr.timeout = 180000;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        progress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onerror = () =>
      reject(
        new Error(
          "영상 전송에 실패했습니다. 연결을 확인한 뒤 다시 업로드해 주세요.",
        ),
      );
    xhr.ontimeout = () =>
      reject(
        new Error(
          "영상 전송 시간이 초과되었습니다. 연결을 확인한 뒤 다시 시도해 주세요.",
        ),
      );
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) resolve(data.videoId);
        else reject(new Error(data.error ?? "영상을 업로드하지 못했습니다."));
      } catch {
        reject(new Error("서버 응답을 읽을 수 없습니다. 다시 시도해 주세요."));
      }
    };
    const form = new FormData();
    form.append("consent", "true");
    form.append("video", file);
    xhr.send(form);
  });
}
export async function videoBlob(id: string) {
  const response = await fetch(`${serverUrl()}/api/videos/${id}`, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  if (!response.ok)
    throw new Error(
      "아직 열람할 수 없는 영상입니다. 제출 상태와 권한을 확인해 주세요.",
    );
  return URL.createObjectURL(await response.blob());
}
