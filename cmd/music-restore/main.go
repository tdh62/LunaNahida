package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"lunanahida/internal/musicrestore"
	"lunanahida/internal/restorefiles"
	"lunanahida/internal/restoreformats"
	"lunanahida/internal/restoreprotocol"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
)

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()
	if err := run(ctx, os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string) error {
	if (len(args) == 1 || len(args) == 2 && args[1] == "--managed") && args[0] == "--describe" {
		// Managed callers attach a process group before closing stdin.
		if len(args) == 2 {
			_, _ = io.Copy(io.Discard, os.Stdin)
		}
		return json.NewEncoder(os.Stdout).Encode(restoreprotocol.Describe())
	}
	if len(args) == 1 && args[0] == "--worker" {
		var request restoreprotocol.Request
		if err := restoreprotocol.Decode(os.Stdin, &request); err != nil {
			return err
		}
		response := restoreprotocol.Response{Protocol: restoreprotocol.Version, RequestID: request.RequestID, Status: "failed", Code: "RESTORE_FAILED"}
		if request.Protocol != restoreprotocol.Version || request.Operation != "restore" || request.RequestID == "" || !filepath.IsAbs(request.Source) || !filepath.IsAbs(request.WorkDir) {
			response.Code, response.Message = "INVALID_REQUEST", "无效的还原请求"
		} else if info, err := os.Lstat(request.WorkDir); err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			response.Message = "无效的任务目录"
		} else {
			restored, err := musicrestore.Restore(ctx, request.Source, request.WorkDir)
			if err != nil {
				response.Message = err.Error()
			} else {
				response = restored
				response.RequestID = request.RequestID
			}
		}
		return json.NewEncoder(os.Stdout).Encode(response)
	}
	if len(args) < 2 || args[0] != "restore" {
		return errors.New("用法：LunaNahida.Converter restore <加密文件> [--output-dir <输出目录>]（保留源文件，不覆盖目标）")
	}
	source, err := filepath.Abs(args[1])
	if err != nil {
		return err
	}
	flags := flag.NewFlagSet("restore", flag.ContinueOnError)
	outputDir := flags.String("output-dir", filepath.Dir(source), "输出目录")
	if err = flags.Parse(args[2:]); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return errors.New("未知参数")
	}
	dir, err := filepath.Abs(*outputDir)
	if err != nil {
		return err
	}
	if err = os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	workDir, err := os.MkdirTemp(dir, restoreformats.JobPrefix)
	if err != nil {
		return err
	}
	defer os.RemoveAll(workDir)
	response, err := musicrestore.Restore(ctx, source, workDir)
	if err != nil {
		return err
	}
	suffix := restoreformats.SourceSuffix(source)
	name := filepath.Base(source)
	if suffix == "" || len(name) <= len(suffix) {
		return errors.New("无效的源文件名")
	}
	output := filepath.Join(dir, name[:len(name)-len(suffix)]+response.Extension)
	if strings.EqualFold(output, source) {
		return errors.New("输出与源文件同名，请指定其他输出目录")
	}
	if err = ctx.Err(); err != nil {
		return err
	}
	staged, err := restoreformats.StagedFile(workDir, response.AudioFile, 0)
	if err != nil {
		return err
	}
	if err = restorefiles.Publish(staged, output); err != nil {
		return err
	}
	fmt.Fprintln(os.Stdout, output)
	return nil
}
