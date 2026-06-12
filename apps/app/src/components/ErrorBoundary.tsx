import React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface ErrorBoundaryProps {
	children: React.ReactNode;
}

interface ErrorBoundaryState {
	error?: Error;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
	state: ErrorBoundaryState = {};

	static getDerivedStateFromError(error: Error): ErrorBoundaryState {
		return { error };
	}

	componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
		console.group("App render error");
		console.error(error);
		console.error(errorInfo.componentStack);
		console.groupEnd();
	}

	private reset = () => {
		this.setState({ error: undefined });
	};

	render() {
		if (!this.state.error) return this.props.children;

		return (
			<div className="mx-auto grid w-full max-w-[34rem] gap-4 p-4">
				<Card>
					<CardHeader>
						<CardDescription>应用异常</CardDescription>
						<CardTitle>页面渲染失败</CardTitle>
					</CardHeader>
					<CardContent className="grid gap-4">
						<p className="text-sm leading-6 text-muted-foreground">
							页面遇到了运行时错误。开发模式下可以查看浏览器控制台获取详细信息。
						</p>
						<pre className="max-h-48 overflow-auto rounded-md border border-error-border bg-error-surface p-3 font-mono text-xs leading-5 text-error-foreground">
							{this.state.error.message}
						</pre>
						<Button type="button" onClick={this.reset}>
							重试
						</Button>
					</CardContent>
				</Card>
			</div>
		);
	}
}
