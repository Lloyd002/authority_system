
from flask import Flask, request, jsonify
import pandas as pd
import requests
import json

app = Flask(__name__)

# === Configuration ===
CSV_FILE = r"D:\auth\submissions.csv"  # your Excel/CSV file
OPENAI_API_KEY = "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"  # replace with your actual key
OPENAI_URL = "https://api.openai.com/v1/chat/completions"

HEADERS = {
    "Authorization": f"Bearer {OPENAI_API_KEY}", 
    "Content-Type": "application/json"
}

# Load the data
df = pd.read_csv(CSV_FILE)
df.fillna("", inplace=True)

# Function to search the sheet
def search_data(query):
    matches = df[df.apply(lambda row: row.astype(str).str.contains(query, case=False).any(), axis=1)]
    return matches.to_dict(orient='records')[:5]  # top 5 results

@app.route('/chat', methods=['POST'])
def chat():
    data = request.json
    user_input = data.get('message', '').strip()
    
    if not user_input:
        return jsonify({"error": "Please enter a valid question."}), 400

    relevant_data = search_data(user_input)

    prompt = f"""You are a helpful assistant. The user asked: "{user_input}"
Here are some relevant authority tracker records:\n{json.dumps(relevant_data, indent=2)}

Based on this data, provide a helpful answer:"""

    payload = {
        "model": "gpt-4",
        "messages": [
            {"role": "user", "content": prompt}
        ],
        "max_tokens": 1200,
        "temperature": 0.5
    }

    try:
        response = requests.post(OPENAI_URL, headers=HEADERS, json=payload)
        response.raise_for_status()
        reply = response.json()['choices'][0]['message']['content']
        return jsonify({"reply": reply})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/')
def index():
    return app.send_static_file('index.html')

if __name__ == '__main__':
    app.run(debug=True)