function ParamList(step, name, some) {
	this._idx = 1;
	this._used = false;
	this.vals = [ null ];
	this.pending = [];
	this.step = step;
	this.name = name;
	this.some = some || false;
}
ParamList.prototype = {
	nextIdx: function(){
		var idx = this._idx++;
		this.pending.push(idx);

		return idx;
	},
	checkPending: function() {
		if(!this._used && this.pending.length === 0) {
			this.step.apply(null, this.vals);
			this._used = true;
		}
	},
	ignore: function(idx){
		var i = this.pending.indexOf(idx);

		if(i!=-1)
			this.pending.splice(i, 1);

		this.checkPending();
	},
	done: function(idx, val, name){
		if(this.some){
			this.pending = [];
			this.vals[1] = {
				'0': name,
				'1': val,
				name: name,
				result: val
			}
		}else{
			var i = this.pending.indexOf(idx);

			if(i!=-1){
				this.pending.splice(i, 1);
				this.vals[idx] = val;
			}
		}

		this.checkPending();
	},
	error: function(err, info) {
		this._used = true;
		err.step = info;
		this.vals[0] = err;
		this.step.apply(null, this.vals);
	}
};

function errInfo(stepName, paramIdx, paramName, subParam){
	return {
		name: stepName,
		paramIdx: paramIdx,
		paramName: paramName,
		subParam: (subParam? {
			paramIdx: 	subParam.paramIdx,
			paramName: subParam.paramName
		} : null)
	};
}

function StepObj(params, jumpTo, end, data){
	this._params = params;
	this.jumpTo = jumpTo;
	this.end = end;
	this.data = data;
}
StepObj.prototype = {
	//TODO sendVal(funcName, name) - oczekiwanie na odpowiedz dopoiero w dalszych czesciach
	val: function(name, filter){
		var
			params = this._params || this,
			paramIdx = params.nextIdx();

		if(typeof name ==='function'){
			filter = name;
			name = null;
		}

		return function(err, val){
			if(filter){
				try{
					val = filter.apply(this, arguments);
					if(val===undefined)
						return params.ignore(paramIdx);
				}catch(e){
					err = e;
				}
			}

			if(err instanceof Error)
				return params.error(err, errInfo(params.name, paramIdx, name));
			else if(val===undefined)
				val = err;

			params.done(paramIdx, val, name);
		};
	},
	some: function(name, filter){
		if(typeof name ==='function'){
			filter = name;
			name = null;
		}
		name = (name || "some");

		var
			self = this,
			params = this._params,
			paramIdx = params.nextIdx(),
			arrayVals = new ParamList(function(err){
				if(err)
					return params.error(err, errInfo(params.name, paramIdx, name, err.step));

				params.done(paramIdx, arrayVals.vals[1]);
			}, name, true);

		process.nextTick(function(){
			arrayVals.checkPending();
		});

		return {
			val: function(name){
				return self.val.call(arrayVals, name, filter);
			}
		};
	},
	valArray: function(name){
		name = name || 'array';

		var
			self = this,
			params = this._params,
			paramIdx = params.nextIdx(),
			arrayVals = new ParamList(function(err){
				if(err)
					return params.error(err, errInfo(params.name, paramIdx, name, err.step));

				params.done(paramIdx, arrayVals.vals.slice(1));
			}, name);

		// Handles arrays of zero length
		process.nextTick(function(){
			arrayVals.checkPending();
		});

		return {
			val: self.val.bind(arrayVals),
			syncVal: self.syncVal.bind(arrayVals)
		};
	},
	syncVal: function(val, name) {
		this.val(name)(null, val);
	},
	listen: function(emitter, name) {
		var params = this._params, paramIdx = params.nextIdx();

		var chunks = [];
		emitter.on('data', function (chunk) { chunks.push(chunk); });
		emitter.on('error', function(err) { params.error(err, errInfo(params.name, paramIdx, name)); });
		emitter.on('end', function() { params.done(paramIdx, chunks); });
	}
};

function TwoStep() {
	var steps =  Array.prototype.slice.call(arguments);
	var curIdx = 0;
	var data = {};

	function jumpTo(func, args){
		this._params._used = true;

		if (typeof func === 'function') {
			func.apply(this, args);
			return;
		}else if(Array.isArray(func)){
			args = func;
			func = undefined;
		}

		if(func===null)
			curIdx++;
		else if(func===undefined)
			curIdx = steps.length
		else{
			for(var i = 0; i < steps.length; i++) {
				if(steps[i].name !== func)
					continue;

				curIdx = i;

				break;
			}
			if(i === steps.length)
				throw Error("Unknown jumpTo location: " + func);
		}

		process.nextTick(function() { nextStep.apply(null, args); });
	}

	function end(func, args){
		if(typeof func !== 'function'){
			args = func;
			func = null;
		}

		jumpTo(func, args)
	}

	function nextStep(err) {
		// If error occurs in the last test, re-throw exception.
		if(err && curIdx === steps.length) { throw err; }

		if(curIdx >= steps.length) { return; }

		var params = new ParamList(nextStep, steps[curIdx].name);
		var stepObj = new StepObj(params, jumpTo, end, data);

		try {
			steps[curIdx++].apply(stepObj, arguments);
			params.checkPending(); // Handle case where nothing async occurs in the callback
		} catch(e) {
			params.error(e, { name: steps[curIdx - 1].name });
		}
	}

	nextStep();
}

module.exports = TwoStep;
