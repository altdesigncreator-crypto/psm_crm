import json
import os
import re
import time
import base64
from urllib.request import Request, urlopen
from urllib.error import HTTPError

API_KEY = os.environ.get("INTEGRATIONS_API_KEY", "")
SUBMIT_URL = "https://app-chfyozakqsqp-api-zYkZzKQJrBdL.gateway.appmedo.com/image-generation/submit"
QUERY_URL = "https://app-chfyozakqsqp-api-GYX1lzGw0DQa.gateway.appmedo.com/image-generation/task"

PROMPT = (
    "Professional app logo for a real estate sales CRM system. "
    "A modern minimalist house icon combined with a handshake symbol, "
    "representing trust and partnership in property sales. "
    "Clean vector style, gradient colors in deep blue and warm orange/gold tones, "
    "white background, high resolution, corporate branding quality, "
    "square format suitable for app icon. No text."
)

def submit_task():
    payload = json.dumps({"contents": [{"parts": [{"text": PROMPT}]}]}).encode("utf-8")
    req = Request(SUBMIT_URL, data=payload, headers={
        "Content-Type": "application/json",
        "X-Gateway-Authorization": f"Bearer {API_KEY}",
    }, method="POST")
    with urlopen(req) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    if data.get("status") != 0:
        raise Exception(f"Submit failed: {data.get('message')}")
    return data["data"]["taskId"]

def query_task(task_id):
    payload = json.dumps({"taskId": task_id}).encode("utf-8")
    req = Request(QUERY_URL, data=payload, headers={
        "Content-Type": "application/json",
        "X-Gateway-Authorization": f"Bearer {API_KEY}",
    }, method="POST")
    with urlopen(req) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    if data.get("status") != 0:
        raise Exception(f"Query failed: {json.dumps(data)}")
    return data["data"]

def extract_base64(task_result):
    text = task_result["result"]["candidates"][0]["content"]["parts"][0]["text"]
    match = re.search(r'data:[^;]+;base64,([^)]+)', text)
    if not match:
        raise Exception("Could not extract Base64 from response")
    return match.group(1)

def main():
    print("Submitting logo generation task...")
    task_id = submit_task()
    print(f"Task submitted: {task_id}")

    deadline = time.time() + 10 * 60
    while time.time() < deadline:
        time.sleep(7)
        result = query_task(task_id)
        status = result.get("status")
        print(f"  Status: {status}")
        if status == "SUCCESS":
            b64 = extract_base64(result)
            out_path = "/workspace/app-chfyozakqsqp/tasks/app-logo.png"
            os.makedirs(os.path.dirname(out_path), exist_ok=True)
            with open(out_path, "wb") as f:
                f.write(base64.b64decode(b64))
            print(f"Logo saved to: {out_path}")
            return
        elif status == "FAILED":
            raise Exception(f"Task failed: {result.get('error')}")
        elif status == "TIMEOUT":
            raise Exception("Task timed out on server")
    raise Exception("Polling timed out after 10 minutes")

if __name__ == "__main__":
    main()
