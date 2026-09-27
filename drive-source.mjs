const PUBLIC_BASE = 'https://5e-google-drive-gateway.5e-desktop.workers.dev/v1/google-drive/folders/1N46Woe4wIXs-PoUpVf0Uu4hPkSIUBqgX/public/';

export class DriveError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'DriveError';
    this.status = status;
  }
}

export function driveLink(path) {
  if (!path) return '';
  const segments = path.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new DriveError('공개 시험지 경로가 올바르지 않습니다.');
  }
  return PUBLIC_BASE + segments.map(encodeURIComponent).join('/');
}

export async function downloadDriveFile(path) {
  const url = driveLink(path);
  if (!url) throw new DriveError('공개 시험지 경로가 없습니다.');
  const response = await fetch(url, { credentials: 'omit' });
  if (!response.ok) {
    throw new DriveError(response.status === 404
      ? '공유 폴더에서 이 시험지를 찾지 못했습니다.'
      : `공개 시험지를 불러오지 못했습니다 (HTTP ${response.status}).`, response.status);
  }
  return response.arrayBuffer();
}
