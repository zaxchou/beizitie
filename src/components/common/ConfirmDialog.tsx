import React from 'react';
import { Dialog, DialogContent, Button, Typography } from '@mui/material';
import { DialogHead, DlgActions, dlgCancelSx, dlgSaveSx } from './DialogKit';

export interface ConfirmDialogProps {
  /** 对话框是否可见 */
  open: boolean;
  /** 对话框标题 */
  title: string;
  /** 提示消息 */
  message: string;
  /** 确认回调 */
  onConfirm: () => void;
  /** 取消回调 */
  onCancel: () => void;
}

/**
 * 通用确认对话框（A1）：等宽小标 + 中文题 + 朱砂确认键。
 * 删除、撤回、中断学习等危险动作共用。
 */
const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  message,
  onConfirm,
  onCancel,
}) => (
  <Dialog
    open={open}
    onClose={onCancel}
    aria-labelledby="confirm-dialog-title"
    aria-describedby="confirm-dialog-description"
    maxWidth="xs"
    fullWidth
  >
    <DialogHead id="confirm-dialog-title" title={title} en="Confirm" />
    <DialogContent sx={{ p: '16px 20px 6px' }}>
      <Typography id="confirm-dialog-description" sx={{ fontSize: 13, lineHeight: 1.9 }}>
        {message}
      </Typography>
    </DialogContent>
    <DlgActions>
      <Button onClick={onCancel} autoFocus sx={dlgCancelSx}>
        取消
      </Button>
      <Button
        onClick={onConfirm}
        variant="contained"
        sx={{ ...dlgSaveSx, backgroundColor: 'var(--hot-ink)' }}
      >
        确认
      </Button>
    </DlgActions>
  </Dialog>
);

export default ConfirmDialog;
