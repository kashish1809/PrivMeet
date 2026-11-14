import { useState } from "react";
import { Download, Trash2 } from "lucide-react";

import { Button, ConfirmDialog, Modal, Select, Toggle } from "../ui";

/**
 * "More": the input device picker, the tab/system audio switch and, once there is audio to
 * lose, Download and Discard. Device and audio choices are remembered in this browser.
 */
export default function OptionsDialog({ open, onClose, s, onDevice, onSystemAudio, onDownload, onDiscard }) {
  const [confirm, setConfirm] = useState(false);
  const devices = s.mic.devices.length ? s.mic.devices : [{ value: "", label: "Default microphone" }];
  const hasAudio = s.phase !== "idle";

  return (
    <>
      <Modal open={open && !confirm} onClose={onClose} title="Recording options" footer={<Button onClick={onClose}>Done</Button>}>
        <div className="flex flex-col gap-5">
          <Select
            label="Microphone"
            value={s.mic.deviceId || devices[0].value}
            onChange={(e) => onDevice(e.target.value)}
            options={devices}
            hint={s.mic.devices.length ? "Switching works during a recording too." : "Allow the microphone to see your devices."}
          />
          <div className="flex flex-col gap-1">
            <Toggle checked={s.systemAudio} onChange={onSystemAudio} label="Include tab or system audio when sharing" />
            <p className="pl-12 text-xs text-zinc-500 dark:text-zinc-400">
              To record a Meet, Zoom or Teams call in the browser: Share, pick its tab, and tick “Share tab audio”.
              Applies to the next share.
            </p>
          </div>
          {hasAudio && (
            <div className="flex flex-wrap gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
              <Button variant="secondary" icon={Download} onClick={onDownload} disabled={!s.blob}>
                Download recording
              </Button>
              <Button variant="ghost" icon={Trash2} onClick={() => setConfirm(true)} className="text-red-600 dark:text-red-400">
                Discard recording
              </Button>
            </div>
          )}
        </div>
      </Modal>
      <ConfirmDialog
        open={confirm}
        title="Discard this recording?"
        confirmLabel="Discard"
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          onDiscard();
          onClose();
        }}
      >
        The audio recorded so far is deleted. Nothing has been uploaded.
      </ConfirmDialog>
    </>
  );
}
