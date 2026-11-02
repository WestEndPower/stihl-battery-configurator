Attribute VB_Name = "STIHLFleetWorkbook"
Option Explicit

Public Sub RestoreAllSTIHLFleetFields()
    Dim name As Variant
    For Each name In Array("products", "attachments", "accessories", "parts")
        RestoreSTIHLFleetFields ThisWorkbook.Worksheets(CStr(name))
    Next name
End Sub

Public Sub RestoreSTIHLFleetFields(ByVal target As Worksheet)
    Dim fields As Variant, field As Variant, master As Worksheet, table As ListObject
    Dim columns As Object, rows As Object, duplicates As Object
    Dim col As Long, r As Long, lastRow As Long, header As String, sku As String
    Dim source As String, ids As String, lookup As String, blankTest As String
    Dim output As ListColumn, candidate As ListColumn, sourceCell As Range
    Dim actual As Variant, expected As Variant, masterRow As Long

    Select Case LCase$(target.Name)
        Case "products", "attachments", "accessories", "parts"
        Case Else: Exit Sub
    End Select
    fields = Array("FleetEligible", "FleetRebateProgram", "FleetTier1Discount", "FleetTier1Rebate", "FleetTier2Discount", "FleetTier2Rebate", "FleetPoints")
    Set master = ThisWorkbook.Worksheets("STIHL Master")
    Set columns = CreateObject("Scripting.Dictionary")
    Set rows = CreateObject("Scripting.Dictionary")
    Set duplicates = CreateObject("Scripting.Dictionary")
    columns.CompareMode = vbTextCompare
    rows.CompareMode = vbTextCompare
    duplicates.CompareMode = vbTextCompare
    For col = 1 To master.Cells(1, master.Columns.Count).End(xlToLeft).Column
        header = Trim$(CStr(master.Cells(1, col).Value2))
        For Each field In fields
            If StrComp(header, CStr(field), vbTextCompare) = 0 Then
                If columns.Exists(header) Then Err.Raise vbObjectError + 2400, , "Duplicate master fleet heading: " & header
                columns.Add header, col
            End If
        Next field
    Next col
    For Each field In fields
        If Not columns.Exists(CStr(field)) Then Err.Raise vbObjectError + 2401, , "Missing master fleet heading: " & field
    Next field
    lastRow = master.Cells(master.Rows.Count, 1).End(xlUp).Row
    For r = 2 To lastRow
        sku = CStr(master.Cells(r, 1).Value2)
        If Len(Trim$(sku)) > 0 Then
            If rows.Exists(sku) Then
                duplicates(sku) = True
            Else
                rows.Add sku, r
            End If
        End If
    Next r
    Set table = target.ListObjects(1)
    If table.DataBodyRange Is Nothing Then Exit Sub
    For r = 1 To table.ListRows.Count
        sku = CStr(table.ListColumns("SKU").DataBodyRange.Cells(r, 1).Value2)
        If Len(Trim$(sku)) > 0 And Not (target.Name = "attachments" And sku = "0000 000 0000") Then
            If Not rows.Exists(sku) Then Err.Raise vbObjectError + 2402, , target.Name & ": SKU missing from master: " & sku
            If duplicates.Exists(sku) Then Err.Raise vbObjectError + 2403, , "Duplicate master SKU: " & sku
        End If
    Next r
    ids = "'STIHL Master'!$A$2:$A$" & lastRow
    For Each field In fields
        Set output = Nothing
        For Each candidate In table.ListColumns
            If StrComp(candidate.Name, CStr(field), vbTextCompare) = 0 Then Set output = candidate
        Next candidate
        If output Is Nothing Then
            Set output = table.ListColumns.Add
            output.Name = CStr(field)
        End If
        source = "'STIHL Master'!" & master.Range(master.Cells(2, CLng(columns(field))), master.Cells(lastRow, CLng(columns(field)))).Address
        lookup = "INDEX(" & source & ",MATCH([@SKU]," & ids & ",0))"
        blankTest = "[@SKU]="""""
        If target.Name = "attachments" Then blankTest = "OR([@SKU]="""",[@SKU]=""0000 000 0000"")"
        output.DataBodyRange.Formula = "=IF(" & blankTest & ","""",IF(" & lookup & "="""",""""," & lookup & "))"
    Next field
    master.Calculate
    target.Calculate
    For r = 1 To table.ListRows.Count
        sku = CStr(table.ListColumns("SKU").DataBodyRange.Cells(r, 1).Value2)
        If Len(Trim$(sku)) > 0 And Not (target.Name = "attachments" And sku = "0000 000 0000") Then
            masterRow = CLng(rows(sku))
            For Each field In fields
                actual = table.ListColumns(CStr(field)).DataBodyRange.Cells(r, 1).Value2
                expected = master.Cells(masterRow, CLng(columns(field))).Value2
                If IsError(actual) Or IsError(expected) Then Err.Raise vbObjectError + 2404, , "Fleet formula error: " & target.Name & " / " & sku & " / " & field
                If CStr(actual) <> CStr(expected) Then Err.Raise vbObjectError + 2405, , "Fleet lookup mismatch: " & target.Name & " / " & sku & " / " & field
            Next field
        End If
    Next r
End Sub
