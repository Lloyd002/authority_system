public class Submission
{
    public int SubmissionID { get; set; }
    public string ProjectNumber { get; set; }
    public string SubmissionType { get; set; }
    public string RequestNo { get; set; }
    public string Status { get; set; }
    public DateTime? PlannedSubmissionDate { get; set; }
    public DateTime? PlannedApprovalDate { get; set; }
    public int? DaysDifference { get; set; }
    public DateTime? ActualSubmissionDate { get; set; }
    public DateTime? ActualApprovalDate { get; set; }
    public string AuthorityRemarks { get; set; }
    public string ActionRemarks { get; set; }
    public string ClientInformed { get; set; }
    public string SubConsultant { get; set; }
}
