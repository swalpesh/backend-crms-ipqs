#include <iostream>
#include <cstdio>
#include <sys/types.h>
#include <sys/stat.h>
#include <unistd.h>
#include <pwd.h>
#include <grp.h>
#include <ctime>
#include <iomanip>
#include <cstring>
#include <limits.h>
#include <errno.h>

using namespace std;

static char filetype_char(mode_t m) {
    if (S_ISREG(m))  return '-';
    if (S_ISDIR(m))  return 'd';
    if (S_ISLNK(m))  return 'l';
    if (S_ISCHR(m))  return 'c';
    if (S_ISBLK(m))  return 'b';
    if (S_ISFIFO(m)) return 'p';
    if (S_ISSOCK(m)) return 's';
    return '?';
}

static string perms_string(mode_t m) {
    char p[10];
    // owner
    p[0] = (m & S_IRUSR) ? 'r' : '-';
    p[1] = (m & S_IWUSR) ? 'w' : '-';
    if (m & S_ISUID) p[2] = (m & S_IXUSR) ? 's' : 'S';
    else              p[2] = (m & S_IXUSR) ? 'x' : '-';
    // group
    p[3] = (m & S_IRGRP) ? 'r' : '-';
    p[4] = (m & S_IWGRP) ? 'w' : '-';
    if (m & S_ISGID) p[5] = (m & S_IXGRP) ? 's' : 'S';
    else              p[5] = (m & S_IXGRP) ? 'x' : '-';
    // others
    p[6] = (m & S_IROTH) ? 'r' : '-';
    p[7] = (m & S_IWOTH) ? 'w' : '-';
    if (m & S_ISVTX) p[8] = (m & S_IXOTH) ? 't' : 'T';
    else              p[8] = (m & S_IXOTH) ? 'x' : '-';
    p[9] = '\0';
    return string(p);
}

int main(int argc, char *argv[]) {
    if (argc <= 1) {
        cerr << "Usage: " << argv[0] << " file_or_directory\n";
        return 2;
    }

    const char *path = argv[1];
    struct stat st;
    // use lstat so symlink itself is inspected (like ls -l)
    if (lstat(path, &st) == -1) {
        perror(path);
        return 1;
    }

    // file type and perms
    char ftype = filetype_char(st.st_mode);
    string perms = perms_string(st.st_mode);

    // link count
    nlink_t links = st.st_nlink;

    // owner name
    struct passwd *pw = getpwuid(st.st_uid);
    const char *owner = pw ? pw->pw_name : "(unknown)";

    // group name
    struct group *gr = getgrgid(st.st_gid);
    const char *group = gr ? gr->gr_name : "(unknown)";

    // size
    off_t size = st.st_size;

    // time formatting similar to `ls -l`
    char timebuf[64];
    time_t now = time(nullptr);
    struct tm *tm = localtime(&st.st_mtime);
    // 6 months in seconds ≈ 15552000 (6 * 30 * 24 * 3600)
    const time_t six_months = 15552000;
    if (llabs((long long)(now - st.st_mtime)) > six_months) {
        // old: "Mon DD  YYYY"
        strftime(timebuf, sizeof(timebuf), "%b %e  %Y", tm);
    } else {
        // recent: "Mon DD HH:MM"
        strftime(timebuf, sizeof(timebuf), "%b %e %H:%M", tm);
    }

    // print line
    cout << ftype << perms << ' ';
    cout << setw(2) << links << ' ';
    cout << setw(8) << left << owner << ' ';
    cout << setw(8) << left << group << ' ';
    cout << setw(8) << right << size << ' ';
    cout << timebuf << ' ' << path;

    // if symlink, show target
    if (S_ISLNK(st.st_mode)) {
        char target[PATH_MAX + 1];
        ssize_t len = readlink(path, target, sizeof(target) - 1);
        if (len != -1) {
            target[len] = '\0';
            cout << " -> " << target;
        }
    }

    cout << '\n';
    return 0;
}
