import { Types } from 'mongoose';
import { OnboardingAuth } from '../db/models/onboarding-auth.model';
import { appendOnboardingToSheet } from './onboarding-sheet.service';
import { pushOnboardingToDrive } from './onboarding-drive.service';


const MAX_ATTEMPTS = 5;

export async function queueOnboardingSync(onboardingAuthId: Types.ObjectId | string): Promise<void> {
  await OnboardingAuth.updateOne(
    { _id: onboardingAuthId },
    { $set: { syncQueuedAt: new Date(), syncAttempts: 0 } },
  ).catch((err) => console.error('[onboarding-sync] could not queue', err));
}

export interface SyncRunResult {
  considered: number;
  completed: number;
  partial: number;
  failed: number;
  sheetsAppended: number;
  filesUploaded: number;
  timedOut: boolean;
}


export async function runPendingOnboardingSyncs(budgetMs = 20_000): Promise<SyncRunResult> {
  const startedAt = Date.now();
  const result: SyncRunResult = {
    considered: 0, completed: 0, partial: 0, failed: 0,
    sheetsAppended: 0, filesUploaded: 0, timedOut: false,
  };

  const due = await OnboardingAuth.find(
    {
      completed: true,
      syncQueuedAt: { $ne: null },
      syncAttempts: { $lt: MAX_ATTEMPTS },
    },
    { _id: 1, sheetConfig: 1, driveConfig: 1, sheetSyncedAt: 1, driveSyncedAt: 1 },
  )
    .sort({ syncQueuedAt: 1 })
    .limit(25)
    .lean();

  for (const auth of due) {
    if (Date.now() - startedAt > budgetMs) {
      result.timedOut = true;
      break;
    }

    result.considered += 1;
    const id = auth._id as Types.ObjectId;
    await OnboardingAuth.updateOne({ _id: id }, { $inc: { syncAttempts: 1 } });

    let sheetDone = !auth.sheetConfig || !!auth.sheetSyncedAt;
    let driveDone = !auth.driveConfig || !!auth.driveSyncedAt;

    if (!sheetDone) {
      const sheet = await appendOnboardingToSheet(id);

      if (sheet.appended) {
        await OnboardingAuth.updateOne(
          { _id: id },
          { $set: { sheetSyncedAt: new Date() }, $unset: { sheetError: 1 } },
        );
        result.sheetsAppended += 1;
        sheetDone = true;
      } else if (sheet.reason === 'failed') {
        // Leave it queued - a Sheets outage should not lose the row.
        await OnboardingAuth.updateOne({ _id: id }, { $set: { sheetError: sheet.error } });
      } else {
        // No sheet configured, or nothing to write. Retrying changes nothing.
        sheetDone = true;
      }
    }

    if (!driveDone) {
      const drive = await pushOnboardingToDrive(id);
      if (drive.synced) {
        result.filesUploaded += drive.uploaded;
        driveDone = drive.failed === 0;
      } else if (drive.reason === 'not_configured' || drive.reason === 'nothing_mapped') {
        driveDone = true;
      }
    }

    if (sheetDone && driveDone) {
      await OnboardingAuth.updateOne({ _id: id }, { $unset: { syncQueuedAt: 1 } });
      result.completed += 1;
    } else {
      result.partial += 1;
    }
  }

  const exhausted = await OnboardingAuth.countDocuments({
    syncQueuedAt: { $ne: null },
    syncAttempts: { $gte: MAX_ATTEMPTS },
  });
  result.failed = exhausted;

  return result;
}
