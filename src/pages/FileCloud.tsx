import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { db, storage } from '@/lib/firebase';
import { isAdmin, isManagement } from '@/lib/roleUtils';
import {
  collection,
  addDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  deleteDoc,
  doc,
  Timestamp,
  getDocs,
} from 'firebase/firestore';
import {
  ref,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
} from 'firebase/storage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  ArrowLeft,
  Upload,
  FileText,
  Image as ImageIcon,
  FileSpreadsheet,
  File as FileIcon,
  Trash2,
  Download,
  HardDrive,
  Loader2,
  X,
  Cloud,
} from 'lucide-react';
import { toast } from 'sonner';

interface UserFile {
  id: string;
  userId: string;
  agentName: string;
  fileName: string;
  fileUrl: string;
  fileType: string;
  fileSize: number;
  createdAt: Timestamp;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function getFileIcon(type: string) {
  if (type.includes('image')) return ImageIcon;
  if (type.includes('sheet') || type.includes('excel') || type.includes('csv')) return FileSpreadsheet;
  if (type.includes('pdf')) return FileText;
  return FileIcon;
}

function getFileColor(type: string): string {
  if (type.includes('image')) return 'bg-info/10 text-info';
  if (type.includes('sheet') || type.includes('excel') || type.includes('csv')) return 'bg-success/10 text-success';
  if (type.includes('pdf')) return 'bg-destructive/10 text-destructive';
  return 'bg-muted text-muted-foreground';
}

export default function FileCloud() {
  const { user, role } = useAuth();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [files, setFiles] = useState<UserFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.uid) return;

    const canSeeAll = isAdmin(role) || isManagement(role);
    const q = canSeeAll
      ? query(collection(db, 'user_files'), orderBy('createdAt', 'desc'))
      : query(
          collection(db, 'user_files'),
          where('userId', '==', user.uid),
          orderBy('createdAt', 'desc')
        );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const data = snap.docs.map((d) => {
          const docData = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            userId: (docData.userId as string) || '',
            agentName: (docData.agentName as string) || '',
            fileName: (docData.fileName as string) || '',
            fileUrl: (docData.fileUrl as string) || '',
            fileType: (docData.fileType as string) || '',
            fileSize: (docData.fileSize as number) || 0,
            createdAt: docData.createdAt as Timestamp,
          } as UserFile;
        });
        setFiles(data);
        setLoading(false);
      },
      () => {
        setLoading(false);
      }
    );
    return () => unsub();
  }, [user?.uid, role]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user?.uid) return;

    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      toast.error('ဖိုင်အရွယ်အစား ၁၀ MB ထက်မကြီးရပါ');
      return;
    }

    setUploading(true);
    setUploadProgress(0);

    try {
      const timestamp = Date.now();
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storagePath = `user_files/${user.uid}/${timestamp}_${safeName}`;
      const storageRef = ref(storage, storagePath);

      const uploadTask = uploadBytesResumable(storageRef, file);

      uploadTask.on(
        'state_changed',
        (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          setUploadProgress(Math.round(progress));
        },
        () => {
          toast.error('ဖိုင်တင်ရာတွင် အမှားဖြစ်သွားပါသည်');
          setUploading(false);
        },
        async () => {
          const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
          await addDoc(collection(db, 'user_files'), {
            userId: user.uid,
            agentName: user.email || 'Unknown',
            fileName: file.name,
            fileUrl: downloadURL,
            fileType: file.type || 'application/octet-stream',
            fileSize: file.size,
            storagePath,
            createdAt: Timestamp.now(),
          });
          toast.success('ဖိုင် တင်ပြီးပါပြီ');
          setUploading(false);
          setUploadProgress(0);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      );
    } catch {
      toast.error('ဖိုင်တင်ရာတွင် အမှားဖြစ်သွားပါသည်');
      setUploading(false);
    }
  };

  const handleDelete = async (f: UserFile) => {
    if (!user?.uid) return;
    if (!window.confirm('ဖိုင်ကို ဖျက်မှာသေချာပါသလား?')) return;

    setDeletingId(f.id);
    try {
      // Try to delete from storage (may fail if path not stored, ignore)
      try {
        const storageRef = ref(storage, `user_files/${f.userId}/${f.fileName}`);
        await deleteObject(storageRef);
      } catch {
        // ignore storage delete errors
      }
      await deleteDoc(doc(db, 'user_files', f.id));
      toast.success('ဖိုင် ဖျက်ပြီးပါပြီ');
    } catch {
      toast.error('ဖိုင်ဖျက်ရာတွင် အမှားဖြစ်သွားပါသည်');
    } finally {
      setDeletingId(null);
    }
  };

  const handleDownload = (url: string, name: string) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const formatDate = (ts: Timestamp) => {
    try {
      return ts.toDate().toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  };

  const totalSize = files.reduce((sum, f) => sum + f.fileSize, 0);

  return (
    <div className="max-w-3xl mx-auto animate-fade-in-up space-y-5 px-1 pb-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-12 w-12 shrink-0 active:bg-muted/50"
          onClick={() => navigate('/settings')}
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl md:text-2xl font-bold text-foreground">File Cloud</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            ကိုယ်ပိုင် ဖိုင်များ သိမ်းဆည်းရန်
          </p>
        </div>
      </div>

      {/* Stats Card */}
      <Card className="shadow-card rounded-xl border-0">
        <CardContent className="p-4 flex items-center gap-4 min-h-[56px]">
          <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <HardDrive className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">
              {files.length} ဖိုင် · {formatBytes(totalSize)}
            </p>
            <p className="text-xs text-muted-foreground">
              {isAdmin(role) || isManagement(role) ? 'ဌာနအားလုံး' : 'ကိုယ်ပိုင် ဖိုင်များ'}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Upload Card */}
      <Card className="shadow-card rounded-xl border-0 overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Cloud className="w-4 h-4 text-primary" />
            </div>
            ဖိုင်တင်ရန်
          </CardTitle>
        </CardHeader>
        <CardContent className="p-5 md:p-6 space-y-4">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv,.pdf,.png,.jpg,.jpeg,.webp,.doc,.docx"
            onChange={handleFileSelect}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="w-full flex flex-col items-center justify-center gap-3 p-6 rounded-xl border-2 border-dashed border-border bg-muted/30 hover:bg-muted/50 active:bg-muted/70 transition-colors min-h-[120px]"
          >
            {uploading ? (
              <>
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 text-primary animate-spin" />
                </div>
                <div className="w-full max-w-xs">
                  <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground text-center mt-2">
                    တင်နေသည်... {uploadProgress}%
                  </p>
                </div>
              </>
            ) : (
              <>
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <Upload className="w-6 h-6 text-primary" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-foreground">
                    ဖိုင်ရွေးချယ်ရန် နှိပ်ပါ
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Excel, PDF, Image, Word (Max 10MB)
                  </p>
                </div>
              </>
            )}
          </button>
        </CardContent>
      </Card>

      {/* File List */}
      <Card className="shadow-card rounded-xl border-0">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <FileText className="w-4 h-4 text-primary" />
            </div>
            သိမ်းဆည်းထားသော ဖိုင်များ
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 md:p-6">
          {loading ? (
            <div className="flex items-center justify-center py-6">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : files.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Cloud className="w-10 h-10 mb-2 opacity-30" />
              <p className="text-sm font-medium">ဖိုင်မရှိသေးပါ</p>
              <p className="text-xs text-muted-foreground mt-1">
                Excel, PDF, Image ဖိုင်များကို တင်နိုင်ပါသည်
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {files.map((f) => {
                const Icon = getFileIcon(f.fileType);
                const colorClass = getFileColor(f.fileType);
                return (
                  <div
                    key={f.id}
                    className="flex items-center gap-3 p-4 rounded-xl border border-border bg-card hover:shadow-card-hover transition-all active:scale-[0.99] min-h-[64px]"
                  >
                    <div
                      className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${colorClass}`}
                    >
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">
                        {f.fileName}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-muted-foreground">
                          {formatBytes(f.fileSize)}
                        </span>
                        <span className="text-[10px] text-muted-foreground">·</span>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(f.createdAt)}
                        </span>
                        {(isAdmin(role) || isManagement(role)) && (
                          <>
                            <span className="text-[10px] text-muted-foreground">·</span>
                            <span className="text-xs text-muted-foreground truncate max-w-[120px]">
                              {f.agentName}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 active:bg-muted"
                        onClick={() => handleDownload(f.fileUrl, f.fileName)}
                      >
                        <Download className="w-4 h-4 text-muted-foreground" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 active:bg-muted"
                        onClick={() => handleDelete(f)}
                        disabled={deletingId === f.id}
                      >
                        {deletingId === f.id ? (
                          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                        ) : (
                          <Trash2 className="w-4 h-4 text-destructive" />
                        )}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
