const express = require('express');
const sql = require('mssql');
const multer = require('multer');
const cors = require('cors');
const dotenv = require('dotenv');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const https = require('https');
// CSV File path - adjust as needed
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const CSV_FILE_PATH = path.join(__dirname, "D:\auth\submissions.csv");
dotenv.config();
const axios = require('axios'); // Using axios instead of requests
const csv = require('csv-parser'); // For CSV parsing
const { Readable } = require('stream');
const app = express();
app.use(cors());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
const upload = multer({ dest: 'uploads/' });

// SQL Server config
const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  options: {
    encrypt: false,
    trustServerCertificate: true
  }
};
let df = [];

function loadCSVData() {
  return new Promise((resolve, reject) => {
      const results = [];
      fs.createReadStream(CSV_FILE_PATH)
          .pipe(csv())
          .on('data', (data) => results.push(data))
          .on('end', () => {
              df = results.map(row => {
                  // Clean up the data (replace empty strings with null)
                  const cleanRow = {};
                  for (const key in row) {
                      cleanRow[key] = row[key] === '' ? null : row[key];
                  }
                  return cleanRow;
              });
              resolve();
          })
          .on('error', reject);
  });
}

// Function to search data (similar to your Python version)
function searchData(query) {
  if (!query || typeof query !== 'string') return [];
  
  const lowerQuery = query.toLowerCase();
  return df.filter(row => {
      return Object.values(row).some(value => 
          value && value.toString().toLowerCase().includes(lowerQuery)
      );
  }).slice(0, 15); // Return top 15 results
}


app.post('/submit', upload.any(), async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig);
    const form = req.body;
    let count = 0;

    while (form[`submissions[${count}].submissionType`]) {
      const data = {
        projectNumber: form.projectNumber,
        projectName: form.projectName,
        emirate: form.emirate,
        authority: form.authority,
        submissionType: form[`submissions[${count}].submissionType`],
        requestNo: form[`submissions[${count}].requestNo`],
        submissionStatus: form[`submissions[${count}].submissionStatus`],
        plannedSubmissionDate: form[`submissions[${count}].plannedSubmissionDate`] || null,
        plannedApprovalDate: form[`submissions[${count}].plannedApprovalDate`] || null,
        actualSubmissionDate: form[`submissions[${count}].actualSubmissionDate`] || null,
        actualApprovalDate: form[`submissions[${count}].actualApprovalDate`] || null,
        authorityRemarks: form[`submissions[${count}].authorityRemarks`] || '',
        actionRemark: form[`submissions[${count}].actionRemark`] || '',
         technicalComments: form[`submissions[${count}].technicalComments`] || '',
        clientInformed: form[`submissions[${count}].clientInformed`] || 'No',
        subConsultant: form[`submissions[${count}].subConsultant`] || '',
        attachmentPath: null,
        daysDifference: form[`daysDifference_${count}`] || null // Initialize as null, will calculate below
      };

      // Calculate days difference if both dates exist
      if (data.plannedSubmissionDate && data.plannedApprovalDate) {
        const date1 = new Date(data.plannedSubmissionDate);
        const date2 = new Date(data.plannedApprovalDate);
        const diffTime = date2 - date1;
        data.daysDifference = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      }

      // Find uploaded file for this row
      const file = req.files?.find(f => f.fieldname === `submissions[${count}].attachments`);
      if (file) data.attachmentPath = file.path;

      await pool.request()
        .input('projectNumber', sql.NVarChar, data.projectNumber)
        .input('projectName', sql.NVarChar, data.projectName)
        .input('emirate', sql.NVarChar, data.emirate)
        .input('authority', sql.NVarChar, data.authority)
        .input('submissionType', sql.NVarChar, data.submissionType)
        .input('requestNo', sql.NVarChar, data.requestNo)
        .input('submissionStatus', sql.NVarChar, data.submissionStatus)
        .input('plannedSubmissionDate', sql.Date, data.plannedSubmissionDate)
        .input('plannedApprovalDate', sql.Date, data.plannedApprovalDate)
        .input('actualSubmissionDate', sql.Date, data.actualSubmissionDate)
        .input('actualApprovalDate', sql.Date, data.actualApprovalDate)
        .input('authorityRemarks', sql.NVarChar, data.authorityRemarks)
        .input('actionRemark', sql.NVarChar, data.actionRemark)
        .input('technicalComments', sql.NVarChar, data.technicalComments)
        .input('clientInformed', sql.NVarChar, data.clientInformed)
        .input('subConsultant', sql.NVarChar, data.subConsultant)
        .input('attachmentPath', sql.NVarChar, data.attachmentPath)
        .input('daysDifference', sql.Int, data.daysDifference)
        .query(`
          INSERT INTO AuthorityTracker (
            projectNumber, projectName, emirate, authority, submissionType, requestNo, submissionStatus,
            plannedSubmissionDate, plannedApprovalDate, actualSubmissionDate, actualApprovalDate,
            authorityRemarks, actionRemark, clientInformed, subConsultant, attachmentPath, daysDifference, technicalComments
          )
          VALUES (
            @projectNumber, @projectName, @emirate, @authority, @submissionType, @requestNo, @submissionStatus,
            @plannedSubmissionDate, @plannedApprovalDate, @actualSubmissionDate, @actualApprovalDate,
            @authorityRemarks, @actionRemark, @clientInformed, @subConsultant, @attachmentPath, @daysDifference,  @technicalComments
          )
        `);
      count++;
    }

    res.status(200).json({ status: 'success', count });
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Get submissions for a project
app.get('/get-submissions', async (req, res) => {
  try {
    const { projectNumber } = req.query;
    const pool = await sql.connect(dbConfig);
    const result = await pool.request()
      .input('projectNumber', sql.NVarChar, projectNumber)
      .query('SELECT * FROM AuthorityTracker WHERE projectNumber = @projectNumber');
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// Update submissions
// Update submissions endpoint
// Update submissions endpoint
app.post('/update', upload.any(), async (req, res) => {
  try {
    const form = req.body;
    const pool = await sql.connect(dbConfig);
    let count = 0;
    let updatedCount = 0;

    while (form[`submissions[${count}].submissionType`]) {
      const entry = {
        projectNumber: form.projectNumber,
        authority: form.authority,
        emirate: form.emirate,
        submissionType: form[`submissions[${count}].submissionType`],
        requestNo: form[`submissions[${count}].requestNo`] || '',
        submissionStatus: form[`submissions[${count}].submissionStatus`] || '',
        plannedSubmissionDate: formatDateForSQL(form[`submissions[${count}].plannedSubmissionDate`]),
        plannedApprovalDate: formatDateForSQL(form[`submissions[${count}].plannedApprovalDate`]),
        actualSubmissionDate: formatDateForSQL(form[`submissions[${count}].actualSubmissionDate`]),
        actualApprovalDate: formatDateForSQL(form[`submissions[${count}].actualApprovalDate`]),
        authorityRemarks: form[`submissions[${count}].authorityRemarks`] || '',
        actionRemark: form[`submissions[${count}].actionRemark`] || '',
        technicalComments: form[`submissions[${count}].technicalComments`] || '',
        clientInformed: form[`submissions[${count}].clientInformed`] || 'No',
        subConsultant: form[`submissions[${count}].subConsultant`] || '',
        daysDifference: form[`submissions[${count}].daysDifference`] || null
      };

      // Handle file attachment if present
      let attachmentPath = null;
      const file = req.files?.find(f => f.fieldname === `submissions[${count}].attachment`);
      if (file) {
        attachmentPath = file.path;
      }

      await pool.request()
        .input('projectNumber', sql.NVarChar, entry.projectNumber)
        .input('authority', sql.NVarChar, entry.authority)
        .input('emirate', sql.NVarChar, entry.emirate)
        .input('submissionType', sql.NVarChar, entry.submissionType)
        .input('requestNo', sql.NVarChar, entry.requestNo)
        .input('submissionStatus', sql.NVarChar, entry.submissionStatus)
        .input('plannedSubmissionDate', sql.Date, entry.plannedSubmissionDate)
        .input('plannedApprovalDate', sql.Date, entry.plannedApprovalDate)
        .input('actualSubmissionDate', sql.Date, entry.actualSubmissionDate)
        .input('actualApprovalDate', sql.Date, entry.actualApprovalDate)
        .input('authorityRemarks', sql.NVarChar, entry.authorityRemarks)
        .input('actionRemark', sql.NVarChar, entry.actionRemark)
        .input('technicalComments', sql.NVarChar, entry.technicalComments)
        .input('clientInformed', sql.NVarChar, entry.clientInformed)
        .input('subConsultant', sql.NVarChar, entry.subConsultant)
        .input('attachmentPath', sql.NVarChar, attachmentPath)
        .input('daysDifference', sql.Int, entry.daysDifference)
        .query(`
          UPDATE AuthorityTracker SET
            submissionStatus = @submissionStatus,
            plannedSubmissionDate = @plannedSubmissionDate,
            plannedApprovalDate = @plannedApprovalDate,
            actualSubmissionDate = @actualSubmissionDate,
            actualApprovalDate = @actualApprovalDate,
            authorityRemarks = @authorityRemarks,
            actionRemark = @actionRemark,
            technicalComments = @technicalComments,
            clientInformed = @clientInformed,
            subConsultant = @subConsultant
            ${attachmentPath ? ', attachmentPath = @attachmentPath' : ''}
            , daysDifference = @daysDifference
          WHERE 
            projectNumber = @projectNumber AND
            authority = @authority AND
            submissionType = @submissionType
        `);
      count++;
      updatedCount++;
    }

    res.status(200).json({ status: 'success', updated: updatedCount });
  } catch (err) {
    console.error("Update error:", err);
    res.status(500).json({ error: err.message });
  }
});

function formatDateForSQL(dateString) {
  if (!dateString) return null;
  try {
    return new Date(dateString).toISOString().split('T')[0];
  } catch {
    return null;
  }
}
app.get('/get-dropdown-values', async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig);
    
    // Get distinct project numbers from A_Project table
    const numbersResult = await pool.request()
      .query('SELECT DISTINCT P_id AS projectNumber FROM A_Project ORDER BY P_id');
    
    // Get distinct project names from A_Project table
    const namesResult = await pool.request()
      .query('SELECT DISTINCT Description AS projectName FROM A_Project ORDER BY Description');
    
    // Get distinct emirates from AuthorityTracker
    const emiratesResult = await pool.request()
      .query('SELECT DISTINCT emirate FROM AuthorityTracker ORDER BY emirate');
    
    // Get distinct authorities from AuthorityTracker
    const authoritiesResult = await pool.request()
      .query('SELECT DISTINCT authority FROM AuthorityTracker ORDER BY authority');

    const submissionTypesResult = await pool.request()
      .query('SELECT DISTINCT submissionType FROM AuthorityTracker ORDER BY submissionType');

    // Get distinct submission statuses from AuthorityTracker
    const statusesResult = await pool.request()
      .query('SELECT DISTINCT submissionStatus FROM AuthorityTracker ORDER BY submissionStatus');

    res.json({
      projectNumbers: numbersResult.recordset.map(r => r.projectNumber),
      projectNames: namesResult.recordset.map(r => r.projectName),
      emirates: emiratesResult.recordset.map(r => r.emirate),
      authorities: authoritiesResult.recordset.map(r => r.authority),
      submissionTypes: submissionTypesResult.recordset.map(r => r.submissionType),
      submissionStatuses: statusesResult.recordset.map(r => r.submissionStatus)
    });
  } catch (err) {
    console.error('Error in get-dropdown-values:', err);
    res.status(500).json({ 
      error: "Database query failed",
      details: err.message 
    });
  }
});

function convertToSqlDate(dateString) {
  if (!dateString) return null;
  // Handle both YYYY-MM-DD (from input) and DD/MM/YYYY formats
  if (dateString.includes('-')) {
    return dateString; // Already in YYYY-MM-DD format
  }
  const parts = dateString.split('/');
  if (parts.length !== 3) return null;
  return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

// Get all submissions for dashboard
app.get('/get-all-submissions', async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig);
    const result = await pool.request()
      .query('SELECT * FROM AuthorityTracker ORDER BY plannedSubmissionDate, projectNumber');
    
    res.json(result.recordset);
  } catch (err) {
    console.error('Gantt chart error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/get-status-options', async (req, res) => {
  try {
    const options = await db.query('SELECT DISTINCT status FROM submissions ORDER BY status');
    res.json(options.map(opt => opt.status));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch status options' });
  }
});
// Get project name mapping
app.get('/get-project-mapping', async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig);
    const result = await pool.request()
      .query('SELECT DISTINCT projectNumber, projectName FROM AuthorityTracker');
    
    const mapping = {};
    result.recordset.forEach(item => {
      mapping[item.projectNumber] = item.projectName;
    });
    
    res.json(mapping);
  } catch (err) {
    console.error('Project mapping error:', err);
    res.status(500).json({ error: err.message });
  }
});
// Get current status options
app.get('/get-status-options', async (req, res) => {
  try {
    // Assuming you have a StatusOptions model/table
    const options = await StatusOptions.find({}, { _id: 0, name: 1 });
    res.json(options.map(opt => opt.name));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update status options
app.post('/update-status-options', async (req, res) => {
  try {
    const { options } = req.body;
    
    // Clear existing options
    await StatusOptions.deleteMany({});
    
    // Insert new options
    const newOptions = options.map(name => ({ name }));
    await StatusOptions.insertMany(newOptions);
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.post('/chat', async (req, res) => {
  try {
      const { message } = req.body; // We only need the message now
      
      if (!message || !message.trim()) {
          return res.status(400).json({ error: "Please enter a valid question." });
      }

      // Search for relevant data - the CSV contains all project info
      const relevant_data = searchData(message);

      // Prepare the prompt - let OpenAI extract context from the data
      const prompt = `User asked about authority submissions: "${message}"

Here are relevant records from our database:
${JSON.stringify(relevant_data, null, 2)}

Please provide a helpful answer about submission statuses, requirements, or processes:`;

      const data = {
          model: "gpt-4o",
          messages: [
              {
                  role: "system",
                  content: "You're an expert assistant for UAE construction authority submissions. Answer based on the provided records."
              },
              {
                  role: "user",
                  content: prompt
              }
          ],
          max_tokens: 1200,
          temperature: 0.5
      };

      const response = await axios.post(OPENAI_URL, data, { 
          headers: {
              "Authorization": `Bearer ${OPENAI_API_KEY}`,
              "Content-Type": "application/json"
          }
      });

      res.json({ reply: response.data.choices[0].message.content });

  } catch (error) {
      console.error('Chat error:', error);
      res.status(500).json({ error: "Sorry, I couldn't process your request. Please try again." });
  }
});
// Add this endpoint to your server.js
app.get('/get-projects', async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig);
    const result = await pool.request()
      .query('SELECT P_id AS projectNumber, Description AS projectName FROM A_Project ORDER BY Description');
    
    if (!result.recordset || result.recordset.length === 0) {
      return res.status(404).json({ error: "No projects found in A_Project table" });
    }
    
    res.json(result.recordset);
  } catch (err) {
    console.error('Error in get-projects:', err);
    res.status(500).json({ 
      error: "Database query failed",
      details: err.message 
    });
  }
})



const PORT = process.env.PORT || 5000;

// Start the server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
}).on('error', (err) => {
  console.error('Server failed to start:', err.message);
  process.exit(1);
});
