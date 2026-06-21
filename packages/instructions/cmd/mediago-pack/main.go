package main

import (
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/mediago-dev/mediago-drama/packages/instructions/pkg/pack"
	"github.com/mediago-dev/mediago-drama/packages/instructions/pkg/pack/codec"
)

func main() {
	if err := run(context.Background(), os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string) error {
	if len(args) == 0 {
		return usage()
	}
	switch args[0] {
	case "pack":
		return runPack(ctx, args[1:])
	case "unpack":
		return runUnpack(ctx, args[1:])
	default:
		return usage()
	}
}

func runPack(ctx context.Context, args []string) error {
	input, output, err := parsePathAndOutput(args, "usage: mediago-pack pack <dir> -o <file.mgpack>")
	if err != nil {
		return err
	}
	archive, err := pack.ArchiveDir(ctx, input)
	if err != nil {
		return err
	}
	if _, err := pack.ParseZip(ctx, archive); err != nil {
		return err
	}
	if err := os.WriteFile(output, codec.Encode(archive), 0o644); err != nil {
		return fmt.Errorf("writing %s: %w", output, err)
	}
	return nil
}

func runUnpack(ctx context.Context, args []string) error {
	input, output, err := parsePathAndOutput(args, "usage: mediago-pack unpack <file.mgpack> -o <dir>")
	if err != nil {
		return err
	}
	data, err := os.ReadFile(input)
	if err != nil {
		return fmt.Errorf("reading %s: %w", input, err)
	}
	archive, err := codec.Decode(data)
	if err != nil {
		return err
	}
	return pack.UnpackZip(ctx, archive, output)
}

func parsePathAndOutput(args []string, usage string) (string, string, error) {
	var input string
	var output string
	for index := 0; index < len(args); index++ {
		arg := strings.TrimSpace(args[index])
		switch {
		case arg == "-o":
			if index+1 >= len(args) {
				return "", "", fmt.Errorf("%s", usage)
			}
			output = strings.TrimSpace(args[index+1])
			index++
		case strings.HasPrefix(arg, "-o="):
			output = strings.TrimSpace(strings.TrimPrefix(arg, "-o="))
		case strings.HasPrefix(arg, "-"):
			return "", "", fmt.Errorf("%s", usage)
		case input == "":
			input = arg
		default:
			return "", "", fmt.Errorf("%s", usage)
		}
	}
	if input == "" || output == "" {
		return "", "", fmt.Errorf("%s", usage)
	}
	return input, output, nil
}

func usage() error {
	return fmt.Errorf("usage: mediago-pack <pack|unpack> ...")
}
