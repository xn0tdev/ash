export namespace app {
	
	export class DirItem {
	    name: string;
	    path: string;
	    is_dir: boolean;
	    size: number;
	
	    static createFrom(source: any = {}) {
	        return new DirItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.is_dir = source["is_dir"];
	        this.size = source["size"];
	    }
	}
	export class FileChange {
	    path: string;
	    status: string;
	
	    static createFrom(source: any = {}) {
	        return new FileChange(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.status = source["status"];
	    }
	}
	export class SandboxInfo {
	    path: string;
	    files: number;
	
	    static createFrom(source: any = {}) {
	        return new SandboxInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.files = source["files"];
	    }
	}
	export class UpdateRelease {
	    hasUpdate: boolean;
	    latest: string;
	    current: string;
	    notes: string;
	    url: string;
	    downloadUrl: string;
	    downloadSize: number;
	    assetName: string;
	
	    static createFrom(source: any = {}) {
	        return new UpdateRelease(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hasUpdate = source["hasUpdate"];
	        this.latest = source["latest"];
	        this.current = source["current"];
	        this.notes = source["notes"];
	        this.url = source["url"];
	        this.downloadUrl = source["downloadUrl"];
	        this.downloadSize = source["downloadSize"];
	        this.assetName = source["assetName"];
	    }
	}

}

