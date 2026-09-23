import { createRequire } from 'node:module';

const require=createRequire(import.meta.url);
const ExcelJS=require('../../backend/node_modules/exceljs');

// Synthetic data reproducing the private staging workbook's classification counts.
// All identifiers, descriptions, work orders, and dates below are invented.
export function buildPmStagingNoopWorkbook(){
  const workbook=new ExcelJS.Workbook();
  workbook.creator='MCC sanitized staging regression';
  workbook.created=new Date('2026-01-01T00:00:00Z');
  const tracker=workbook.addWorksheet('Machine Pm Tracker');
  tracker.getRow(4).values=['Press:','88000'];
  tracker.getRow(5).values=['Interval Type','Interval Cycles','Last Completed Date / Last hourly','Today Date / Hourly','Due Date','Status','Task Description'];
  let validRows=0;
  for(let row=6;row<=74;row++){
    const rejected=row===31;
    tracker.getRow(row).values=['Hourly',500,rejected?'invalid':100,200,null,!rejected&&validRows<65?'Review required':null,`Synthetic task ${row}`];
    if(!rejected)validRows++;
  }
  const history=workbook.addWorksheet('PMHistory');
  history.getRow(1).values=['AssetNo','Work order #','Task Status','Start Date','End Date','Work Order Type','Perform By:','Interval Type','Task Type','Task Note'];
  for(let row=0;row<28;row++)history.addRow([String(88001+row%14),`WO-SYNTHETIC-${row}`,'Completed',new Date('2026-01-01T00:00:00Z'),new Date('2026-01-02T00:00:00Z'),'Preventive Maintenance','Synthetic technician','Hourly',`Synthetic history ${row}`,'Synthetic completion']);
  return workbook;
}
