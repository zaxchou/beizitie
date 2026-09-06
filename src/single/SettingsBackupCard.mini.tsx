import React from 'react';
import { Typography, Card, CardContent } from '@mui/material';

/** mini 构建：容器禁用下载与文件选择，无导出/导入——以进度说明卡替代数据备份卡。 */
export const SettingsBackupCard: React.FC<{ onChanged?: () => void }> = () => (
  <>
    <Card variant="outlined" sx={{ borderRadius: 2 }}>
      <CardContent>
        <Typography sx={{ fontWeight: 600, mb: 0.5 }}>学习进度</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.8 }}>
          进度自动保存在本机（IndexedDB），无需登录。
          <br />
          注意：删除本工具或清理小红书缓存会清空进度，记得常回来复习。
        </Typography>
      </CardContent>
    </Card>
  </>
);

export default SettingsBackupCard;
