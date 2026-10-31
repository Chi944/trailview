import { handleParseRequest, type ParseRequest } from './parseRequest.ts'

// Parses one log off the main thread, so a large file does not freeze the tab.
// The page starts a fresh worker for each file and terminates it to cancel.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<ParseRequest>) => void) | null
  postMessage: (message: unknown) => void
}

scope.onmessage = (e) => {
  void handleParseRequest(e.data, (message) => scope.postMessage(message))
}
