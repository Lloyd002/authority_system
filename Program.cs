using Microsoft.Data.SqlClient;
using System.Data;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowAll", policy =>
    {
        policy.AllowAnyOrigin()
              .AllowAnyMethod()
              .AllowAnyHeader();
    });
});
builder.Services.AddEndpointsApiExplorer();

string connectionString = builder.Configuration.GetConnectionString("DefaultConnection");

var app = builder.Build();
app.UseCors("AllowAll")
app.MapPost("/submit", async (HttpRequest request) =>
{
    try
    {
        var form = await request.ReadFormAsync();
        var projectNumber = form["projectNumber"].ToString();
        var emirate = form["emirate"].ToString();
        var authority = form["authority"].ToString();

        // Process each submission row
        var submissionIndexes = form.Keys
            .Where(k => k.StartsWith("submissions["))
            .Select(k => int.Parse(k.Split('[')[1].Split(']')[0]))
            .Distinct()
            .ToList();

        var submissionIds = new List<int>();

        using (var conn = new SqlConnection(connectionString))
        {
            await conn.OpenAsync();
            
            foreach (var index in submissionIndexes)
            {
                var prefix = $"submissions[{index}].";
                
                DateTime.TryParse(form[$"{prefix}plannedSubmissionDate"], out DateTime plannedSub);
                DateTime.TryParse(form[$"{prefix}plannedApprovalDate"], out DateTime plannedApp);
                DateTime.TryParse(form[$"{prefix}actualSubmissionDate"], out DateTime actualSub);
                DateTime.TryParse(form[$"{prefix}actualApprovalDate"], out DateTime actualApp);
                
                int? daysDiff = (plannedApp != default && plannedSub != default)
                    ? (int?)(plannedApp - plannedSub).TotalDays : null;

                // Insert submission
                var cmd = new SqlCommand(@"
                    INSERT INTO Submissions
                    (ProjectNumber, Emirate, Authority, SubmissionType, RequestNo, Status, 
                     PlannedSubmissionDate, PlannedApprovalDate, DaysDifference,
                     ActualSubmissionDate, ActualApprovalDate, AuthorityRemarks, 
                     ActionRemarks, ClientInformed, SubConsultant)
                    OUTPUT INSERTED.SubmissionID
                    VALUES 
                    (@ProjectNumber, @Emirate, @Authority, @SubmissionType, @RequestNo, @Status, 
                     @PlannedSubmissionDate, @PlannedApprovalDate, @DaysDifference,
                     @ActualSubmissionDate, @ActualApprovalDate, @AuthorityRemarks, 
                     @ActionRemarks, @ClientInformed, @SubConsultant)", conn);

                cmd.Parameters.AddWithValue("@ProjectNumber", projectNumber);
                cmd.Parameters.AddWithValue("@Emirate", emirate);
                cmd.Parameters.AddWithValue("@Authority", authority);
                cmd.Parameters.AddWithValue("@SubmissionType", form[$"{prefix}submissionType"].ToString() ?? (object)DBNull.Value);
                cmd.Parameters.AddWithValue("@RequestNo", form[$"{prefix}requestNo"].ToString() ?? (object)DBNull.Value);
                cmd.Parameters.AddWithValue("@Status", form[$"{prefix}submissionStatus"].ToString() ?? (object)DBNull.Value);
                cmd.Parameters.AddWithValue("@PlannedSubmissionDate", (object)plannedSub ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@PlannedApprovalDate", (object)plannedApp ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@DaysDifference", (object?)daysDiff ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@ActualSubmissionDate", (object)actualSub ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@ActualApprovalDate", (object)actualApp ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@AuthorityRemarks", form[$"{prefix}authorityRemarks"].ToString() ?? (object)DBNull.Value);
                cmd.Parameters.AddWithValue("@ActionRemarks", form[$"{prefix}actionRemark"].ToString() ?? (object)DBNull.Value);
                cmd.Parameters.AddWithValue("@ClientInformed", form[$"{prefix}clientInformed"].ToString() ?? (object)DBNull.Value);
                cmd.Parameters.AddWithValue("@SubConsultant", form[$"{prefix}subConsultant"].ToString() ?? (object)DBNull.Value);

                var submissionId = (int)await cmd.ExecuteScalarAsync();
                submissionIds.Add(submissionId);

                // Process files for this submission
                var files = form.Files.Where(f => f.Name.StartsWith($"{prefix}attachments"));
                if (files.Any())
                {
                    string uploadRoot = Path.Combine("wwwroot", "uploads", submissionId.ToString());
                    Directory.CreateDirectory(uploadRoot);

                    foreach (var file in files)
                    {
                        string fileName = Path.GetFileName(file.FileName);
                        string savePath = Path.Combine(uploadRoot, fileName);

                        using (var stream = new FileStream(savePath, FileMode.Create))
                        {
                            await file.CopyToAsync(stream);
                        }

                        var fileCmd = new SqlCommand(@"
                            INSERT INTO Attachments (SubmissionID, FileName, FilePath, FileSize)
                            VALUES (@SubmissionID, @FileName, @FilePath, @FileSize)", conn);

                        fileCmd.Parameters.AddWithValue("@SubmissionID", submissionId);
                        fileCmd.Parameters.AddWithValue("@FileName", fileName);
                        fileCmd.Parameters.AddWithValue("@FilePath", savePath);
                        fileCmd.Parameters.AddWithValue("@FileSize", file.Length);

                        await fileCmd.ExecuteNonQueryAsync();
                    }
                }
            }
        }

        return Results.Ok(new { 
            message = "Submission successful", 
            submissionIds = submissionIds,
            count = submissionIds.Count
        });
    }
    catch (Exception ex)
    {
        return Results.Problem($"Error processing submission: {ex.Message}");
    }
});
app.UseStaticFiles();
app.Run();
