import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {prepareMasterExport} from '../backend/dist/server/libraryMasterExport.js';
import {LibraryUploadError,LibraryUploadReservationCoordinator,ResumableLibraryUploadStore} from '../backend/dist/server/libraryResumableUpload.js';

const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'mcc-pr-134-'));

try{
  const coordinator=new LibraryUploadReservationCoordinator();
  const policy={documentsMb:null,picturesMb:null,videosMb:null,chunkBytes:128,storageReserveBytes:0,sessionTtlMs:60_000};
  const availableBytes=()=>250;
  const machine=new ResumableLibraryUploadStore({directory:path.join(fixture,'machine','.resumable'),scope:'machine',policy,reservationCoordinator:coordinator,availableBytes});
  const equipment=new ResumableLibraryUploadStore({directory:path.join(fixture,'equipment','.resumable'),scope:'equipment',policy,reservationCoordinator:coordinator,availableBytes});
  const facility=new ResumableLibraryUploadStore({directory:path.join(fixture,'facility','.resumable'),scope:'facility',policy,reservationCoordinator:coordinator,availableBytes});
  const machineUpload=machine.create({ownerUserId:1,originalName:'machine.pdf',sizeBytes:100,context:{assetId:1,folderId:1}});
  const equipmentUpload=equipment.create({ownerUserId:1,originalName:'equipment.pdf',sizeBytes:100,context:{assetId:2,folderId:2}});
  assert.equal(equipmentUpload.sizeBytes,100,'Reservations may span Machine and Equipment while combined capacity remains available.');
  assert.throws(()=>facility.create({ownerUserId:1,originalName:'facility.pdf',sizeBytes:51,context:{areaId:3,folderId:3}}),error=>error instanceof LibraryUploadError&&error.status===507&&error.code==='INSUFFICIENT_STORAGE','Facility must honor the combined Machine and Equipment reservations.');
  machine.cancel(machineUpload.id,1);
  const facilityUpload=facility.create({ownerUserId:1,originalName:'facility.pdf',sizeBytes:51,context:{areaId:3,folderId:3}});
  assert.equal(facilityUpload.sizeBytes,51,'Released reservations must become available across library scopes.');

  const storedFile=path.join(fixture,'extensionless-source');fs.writeFileSync(storedFile,'extensionless');
  await assert.rejects(prepareMasterExport({rootName:'MCC_Asset_Library_Export',appVersion:'test',directories:['Machines/Press/Manuals'],files:[{archivePath:'Machines/Press/Manuals',sourcePath:storedFile,sizeBytes:13,downloadUrl:'/fixture'}]}),/duplicate path: Machines\/Press\/Manuals/,'An extensionless file must collide with a folder at the same normalized archive path.');

  console.log('PR #134 review regressions passed for global resumable reservations and normalized file/folder Master Export collisions.');
}finally{
  fs.rmSync(fixture,{recursive:true,force:true});
}
