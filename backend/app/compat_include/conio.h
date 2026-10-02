/* Minimal Turbo C `conio.h` compatibility shim: just enough to make
 * `clrscr()`/`getch()` work on Linux without the student needing a real
 * conio.h. Every compile force-includes this file (see -include in
 * compiler_service.py) so these two symbols exist even if the student's
 * code never writes #include <conio.h> at all -- mirroring how Turbo C's
 * own runtime library always linked them in regardless of the include.
 *
 * Needs _POSIX_C_SOURCE defined before <termios.h>/<unistd.h> are pulled
 * in, since strict -std=c90/c99/c11/c17/c23 (as opposed to -std=gnuXX)
 * otherwise hides POSIX terminal APIs from glibc's headers.
 */
#ifndef TURBOC_COMPAT_CONIO_H
#define TURBOC_COMPAT_CONIO_H

#ifndef _POSIX_C_SOURCE
#define _POSIX_C_SOURCE 200809L
#endif

#include <stdio.h>
#include <termios.h>
#include <unistd.h>

/* __attribute__((unused)) avoids a -Wunused-function warning on every
 * single compile for programs that don't actually call these -- which is
 * most of them, since this header is forced into every translation unit. */

__attribute__((unused))
static void clrscr(void) {
    fputs("\x1b[2J\x1b[H", stdout);
    fflush(stdout);
}

__attribute__((unused))
static int getch(void) {
    struct termios oldattr, newattr;
    int ch;

    if (tcgetattr(STDIN_FILENO, &oldattr) != 0) {
        return getchar();
    }
    newattr = oldattr;
    newattr.c_lflag &= (tcflag_t) ~(ICANON | ECHO);
    tcsetattr(STDIN_FILENO, TCSANOW, &newattr);

    ch = getchar();

    tcsetattr(STDIN_FILENO, TCSANOW, &oldattr);
    return ch;
}

#endif /* TURBOC_COMPAT_CONIO_H */
