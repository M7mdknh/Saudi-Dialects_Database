export default function AccessDeniedPage() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-sm flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-danger text-xl font-bold">لا تملك صلاحية الوصول</h1>
      <p className="text-foreground/70">
        حسابك ليس ضمن قائمة المشرفين النشطين. تواصل مع مسؤول النظام إذا كنت
        تعتقد أن هذا خطأ.
      </p>
    </main>
  );
}
