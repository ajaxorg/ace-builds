import errno
import os
import sys
import warnings
from functools import wraps
from typing import Any, Callable, cast, Optional, overload, Sequence, TextIO, Type, TYPE_CHECKING, Union

import click

# Group, Command, and CommandCollection need to be imported directly,
# or else rich_click.cli.patch() causes a recursion error.
from click import Command, CommandCollection, Group
from click.utils import make_str, PacifyFlushWrapper
from rich.console import Console

from rich_click._compat_click import CLICK_IS_BEFORE_VERSION_8X, CLICK_IS_BEFORE_VERSION_9X
from rich_click.rich_click import rich_abort_error, rich_format_error, rich_format_help
from rich_click.rich_context import RichContext
from rich_click.rich_help_configuration import RichHelpConfiguration
from rich_click.rich_help_formatter import RichHelpFormatter


class RichCommand(click.Command):
    """Richly formatted click Command.

    Inherits click.Command and overrides help and error methods
    to print richly formatted output.

    This class can be used as a mixin for other click command objects.
    """

    context_class: Type[RichContext] = RichContext
    _formatter: Optional[RichHelpFormatter] = None

    @wraps(Command.__init__)
    def __init__(self, *args: Any, **kwargs: Any):
        """Create Rich Command instance."""
        super().__init__(*args, **kwargs)
        self._register_rich_context_settings_from_callback()

    def _register_rich_context_settings_from_callback(self) -> None:
        if self.callback is not None:
            if hasattr(self.callback, "__rich_context_settings__"):
                rich_context_settings = getattr(self.callback, "__rich_context_settings__", {})
                for k, v in rich_context_settings.items():
                    self.context_settings.setdefault(k, v)
                del self.callback.__rich_context_settings__

    @property
    def console(self) -> Optional[Console]:
        """Rich Console.

        This is a separate instance from the help formatter that allows full control of the
        console configuration.

        See `rich_config` decorator for how to apply the settings.
        """
        return self.context_settings.get("rich_console")

    @property
    def help_config(self) -> Optional[RichHelpConfiguration]:
        """Rich Help Configuration."""
        return self.context_settings.get("rich_help_config")

    @property
    def formatter(self) -> RichHelpFormatter:
        """Rich Help Formatter.

        This is separate instance from the formatter used to display help,
        but is created from the same `RichHelpConfiguration`. Currently only used
        for error reporting.
        """
        if self._formatter is None:
            self._formatter = RichHelpFormatter(config=self.help_config)
        return self._formatter

    def main(
        self,
        args: Optional[Sequence[str]] = None,
        prog_name: Optional[str] = None,
        complete_var: Optional[str] = None,
        standalone_mode: bool = True,
        windows_expand_args: bool = True,
        **extra: Any,
    ) -> Any:
        # It's not feasible to use super().main() in this context and retain exact parity in behavior.
        # The reason why is explained in a comment in click's source code in the "except Exit as e" block.

        if args is None:
            if CLICK_IS_BEFORE_VERSION_8X:
                from click.utils import get_os_args  # type: ignore[attr-defined]

                args: Sequence[str] = get_os_args()  # type: ignore[no-redef]
            else:
                args = sys.argv[1:]

                if os.name == "nt" and windows_expand_args:
                    from click.utils import _expand_args

                    args = _expand_args(args)
        else:
            args = list(args)

        if TYPE_CHECKING:
            assert args is not None

        if prog_name is None:
            if CLICK_IS_BEFORE_VERSION_8X:
                prog_name = make_str(os.path.basename(sys.argv[0] if sys.argv else __file__))
            else:
                from click.utils import _detect_program_name

                prog_name = _detect_program_name()

        # Process shell completion requests and exit early.
        if CLICK_IS_BEFORE_VERSION_8X:
            from click.core import _bashcomplete  # type: ignore[attr-defined]

            _bashcomplete(self, prog_name, complete_var)
        else:
            self._main_shell_completion(extra, prog_name, complete_var)

        try:
            try:
                with self.make_context(prog_name, args, **extra) as ctx:
                    rv = self.invoke(ctx)
                    if not standalone_mode:
                        return rv
                    # it's not safe to `ctx.exit(rv)` here!
                    # note that `rv` may actually contain data like "1" which
                    # has obvious effects
                    # more subtle case: `rv=[None, None]` can come out of
                    # chained commands which all returned `None` -- so it's not
                    # even always obvious that `rv` indicates success/failure
                    # by its truthiness/falsiness
                    ctx.exit()
            except (EOFError, KeyboardInterrupt):
                click.echo(file=sys.stderr)
                raise click.exceptions.Abort() from None
            except click.exceptions.ClickException as e:
                rich_format_error(e, self.formatter)
                if not standalone_mode:
                    raise
                sys.stderr.write(self.formatter.getvalue())
                sys.exit(e.exit_code)
            except OSError as e:
                if e.errno == errno.EPIPE:
                    sys.stdout = cast(TextIO, PacifyFlushWrapper(sys.stdout))
                    sys.stderr = cast(TextIO, PacifyFlushWrapper(sys.stderr))
                    sys.exit(1)
                else:
                    raise
        except click.exceptions.Exit as e:
            if standalone_mode:
                sys.exit(e.exit_code)
            else:
                return e.exit_code
        except click.exceptions.Abort:
            rich_abort_error(self.formatter)
            if not standalone_mode:
                raise
            sys.stderr.write(self.formatter.getvalue())
            sys.exit(1)

    def format_help(self, ctx: click.Context, formatter: click.HelpFormatter) -> None:
        rich_format_help(self, ctx, formatter)


class RichGroup(RichCommand, Group):
    """Richly formatted click Group.

    Inherits click.Group and overrides help and error methods
    to print richly formatted output.
    """

    command_class: Optional[Type[RichCommand]] = RichCommand
    group_class: Optional[Union[Type[Group], Type[type]]] = type

    @wraps(Group.__init__)
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        """Initialize RichGroup class."""
        Group.__init__(self, *args, **kwargs)
        self._register_rich_context_settings_from_callback()

    if CLICK_IS_BEFORE_VERSION_8X:

        @overload
        def command(self, __func: Callable[..., Any]) -> Command:
            ...

        @overload
        def command(self, *args: Any, **kwargs: Any) -> Callable[[Callable[..., Any]], Command]:
            ...

        def command(self, *args: Any, **kwargs: Any) -> Union[Callable[[Callable[..., Any]], Command], Command]:
            # This method override is required for Click 7.x compatibility.
            # (The command_class ClassVar was not added until 8.0.)
            if self.command_class is not None:
                kwargs.setdefault("cls", self.command_class)
            return super().command(*args, **kwargs)  # type: ignore[no-any-return]

        @overload
        def group(self, __func: Callable[..., Any]) -> Group:
            ...

        @overload
        def group(self, *args: Any, **kwargs: Any) -> Callable[[Callable[..., Any]], Group]:
            ...

        def group(self, *args: Any, **kwargs: Any) -> Union[Callable[[Callable[..., Any]], Group], Group]:
            # This method override is required for Click 7.x compatibility.
            # (The group_class ClassVar was not added until 8.0.)
            if self.group_class is type:
                kwargs.setdefault("cls", self.__class__)
            elif self.group_class is not None:
                kwargs.setdefault("cls", self.group_class)
            return super().group(*args, **kwargs)  # type: ignore[no-any-return]


if CLICK_IS_BEFORE_VERSION_9X:
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", category=DeprecationWarning, module="click")
        from click import MultiCommand

        class RichMultiCommand(RichCommand, MultiCommand):
            """Richly formatted click MultiCommand.

            Inherits click.MultiCommand and overrides help and error methods
            to print richly formatted output.
            """

        @wraps(MultiCommand.__init__)
        def __init__(self, *args: Any, **kwargs: Any) -> None:  # type: ignore[no-untyped-def]
            """Initialize RichGroup class."""
            from click import MultiCommand

            MultiCommand.__init__(self, *args, **kwargs)
            self._register_rich_context_settings_from_callback()

else:

    class RichMultiCommand(RichGroup):  # type: ignore[no-redef]
        """This class is deprecated."""


class RichCommandCollection(RichGroup, CommandCollection):
    """Richly formatted click CommandCollection.

    Inherits click.CommandCollection and overrides help and error methods
    to print richly formatted output.
    """

    @wraps(CommandCollection.__init__)
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        """Initialize RichCommandCollection class."""
        CommandCollection.__init__(self, *args, **kwargs)
        self._register_rich_context_settings_from_callback()
