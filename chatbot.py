import pandas as pd
import requests
import json
import re
from flask import Flask, request, jsonify
from flask_cors import CORS
import pyodbc
from datetime import date, datetime

# === Configuration ===
CSV_FILE = r"D:\auth\submissions.csv"
OPENAI_API_KEY = "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"  # Masked for security
OPENAI_URL = "https://api.openai.com/v1/chat/completions"

HEADERS = {
    "Authorization": f"Bearer {OPENAI_API_KEY}",
    "Content-Type": "application/json"
}

# SQL Server connection strings
conn_main = (
    "DRIVER={ODBC Driver 17 for SQL Server};"
    "SERVER=192.168.6.15;"
    "DATABASE=AuthorityPortalProd_V2;"
    "UID=praveena;"
    "PWD=Test@1234;"
)

conn_tracker = (
    "DRIVER={ODBC Driver 17 for SQL Server};"
    "SERVER=192.168.6.15;"
    "DATABASE=AuthorityTracker;"
    "UID=praveena;"
    "PWD=Test@1234;"
)

# Load CSV
df = pd.read_csv(CSV_FILE)
df.fillna("", inplace=True)

# === Flask Setup ===
app = Flask(__name__, static_url_path="", static_folder="static")
CORS(app)

def get_known_values():
    with pyodbc.connect(conn_main) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT DISTINCT [EntityName] FROM Entities")
        authorities = [row[0] for row in cursor.fetchall()]
        cursor.execute("SELECT DISTINCT [Submission] FROM Submissions")
        submissions = [row[0] for row in cursor.fetchall()]
    return authorities, submissions

def generate_sql_query(user_input):
    authorities, submissions = get_known_values()
    use_tracker = "tracker" in user_input.lower()

    system_prompt = f"""
You are an expert SQL developer for the AuthorityPortalProd_V2 and AuthorityTracker databases.Don't include database name before table name for writing queries
Convert the user's natural language into SQL queries based on the context.

Use the following schemas:

If the user query contains "tracker", use this:
Table: AuthorityTracker(
  [projectNumber], [emirate], [authority], [submissionType], [requestNo], [submissionStatus],
  [plannedSubmissionDate], [plannedApprovalDate], [actualSubmissionDate], [actualApprovalDate],
  [authorityRemarks], [actionRemark], [clientInformed], [subConsultant], [attachmentPath],
  [daysDifference], [projectName], [technicalComments]
)

Otherwise, use this schema from:
- Entities(EntityID, EntityName)
- Submissions(SubmissionID, Submission, SubmitThroughEntityID)
- MainAuthSubmissionsV2(MainAuthorityID, SubmissionID, AuthSubID)
- PrereqSubMappingV2(AuthSubID, PrereqID)
- Prerequisites_V2(PrereqID, PrereqItem)

Known Authorities: {', '.join(authorities)}
Known Submissions: {', '.join(submissions)}

Rules:
1. Always use TOP 100 unless stated otherwise.
2. Use CAST(GETDATE() AS DATE) for the current date.
3.Don't include database name before table name.
4. Use JOINs with table aliases.
5. Include the database name in all table references.
6. Return ONLY the SQL query (no extra text).
7. Use LIKE for fuzzy text matches.
8. Use OR for combining multiple search terms.
"""

    payload = {
        "model": "gpt-4o",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_input}
        ],
        "max_tokens": 800,
        "temperature": 0.3
    }

    response = requests.post(OPENAI_URL, headers=HEADERS, json=payload)
    response.raise_for_status()
    raw_sql = response.json()['choices'][0]['message']['content']

    def validate_and_fix_sql(sql):
        sql = re.sub(r'```sql|```', '', sql).strip()
        sql = re.sub(r'^(Here is|The|SQL Query:|Query:).*?\n', '', sql, flags=re.IGNORECASE)
        open_paren = sql.count('(')
        close_paren = sql.count(')')
        while open_paren > close_paren:
            sql += ')'
            close_paren += 1
        if not sql.rstrip().endswith(';'):
            sql += ';'
        sql = sql.split(';')[0] + ';'
        if not re.match(r'^\s*(SELECT|WITH)', sql, re.IGNORECASE):
            raise ValueError(f"Invalid SQL: {sql}")
        return sql.strip()

    return validate_and_fix_sql(raw_sql), use_tracker

def execute_sql_and_respond(user_input):
    try:
        sql, use_tracker = generate_sql_query(user_input)
        print(f"[INFO] Generated SQL: {sql}")
        connection_string = conn_tracker if use_tracker else conn_main
        print(f"[INFO] Using DB: {'AuthorityTracker' if use_tracker else 'AuthorityPortalProd_V2'}")

        with pyodbc.connect(connection_string) as conn:
            cursor = conn.cursor()
            cursor.execute(sql)
            columns = [col[0] for col in cursor.description]
            results = [
                {col: (val.isoformat() if isinstance(val, (date, datetime)) else val)
                 for col, val in zip(columns, row)}
                for row in cursor.fetchall()
            ]

        summary_prompt = {
            "model": "gpt-4o",
            "messages": [
                {"role": "system", "content": "You are a helpful assistant that explains SQL results in natural language."},
                {"role": "user", "content": f"User asked: '{user_input}'\n\nSQL Results:\n{json.dumps(results, indent=2)}\n\nPlease provide a helpful response:"}
            ],
            "max_tokens": 800,
            "temperature": 0.5
        }

        response = requests.post(OPENAI_URL, headers=HEADERS, json=summary_prompt)
        response.raise_for_status()
        return response.json()['choices'][0]['message']['content']

    except pyodbc.Error as e:
        print(f"[ERROR] DB Error: {e}")
        return f"Database error: {str(e)}"
    except requests.RequestException as e:
        print(f"[ERROR] API Error: {e}")
        return "OpenAI API communication error."
    except Exception as e:
        print(f"[ERROR] Unexpected: {e}")
        return f"Unexpected error occurred: {str(e)}"

@app.route("/")
def index():
    return app.send_static_file("index.html")

@app.route("/chat", methods=["POST"])
def chat():
    try:
        data = request.json
        user_input = data.get("message", "").strip()
        if not user_input:
            return jsonify({"error": "Empty input"}), 400

        reply = execute_sql_and_respond(user_input)
        return jsonify({"response": reply})
    except Exception as e:
        print(f"[ERROR] Chat Route: {e}")
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(debug=True, port=5000)
