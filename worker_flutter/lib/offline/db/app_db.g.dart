// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'app_db.dart';

// ignore_for_file: type=lint
class $JobsTable extends Jobs with TableInfo<$JobsTable, Job> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $JobsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<int> id = GeneratedColumn<int>(
    'id',
    aliasedName,
    false,
    hasAutoIncrement: true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'PRIMARY KEY AUTOINCREMENT',
    ),
  );
  static const VerificationMeta _nameMeta = const VerificationMeta('name');
  @override
  late final GeneratedColumn<String> name = GeneratedColumn<String>(
    'name',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _createdAtMeta = const VerificationMeta(
    'createdAt',
  );
  @override
  late final GeneratedColumn<DateTime> createdAt = GeneratedColumn<DateTime>(
    'created_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _totalSimsMeta = const VerificationMeta(
    'totalSims',
  );
  @override
  late final GeneratedColumn<int> totalSims = GeneratedColumn<int>(
    'total_sims',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _completedSimsMeta = const VerificationMeta(
    'completedSims',
  );
  @override
  late final GeneratedColumn<int> completedSims = GeneratedColumn<int>(
    'completed_sims',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
    defaultValue: const Constant(0),
  );
  static const VerificationMeta _stateMeta = const VerificationMeta('state');
  @override
  late final GeneratedColumn<String> state = GeneratedColumn<String>(
    'state',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant('PENDING'),
  );
  static const VerificationMeta _deck1NameMeta = const VerificationMeta(
    'deck1Name',
  );
  @override
  late final GeneratedColumn<String> deck1Name = GeneratedColumn<String>(
    'deck1_name',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _deck2NameMeta = const VerificationMeta(
    'deck2Name',
  );
  @override
  late final GeneratedColumn<String> deck2Name = GeneratedColumn<String>(
    'deck2_name',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _deck3NameMeta = const VerificationMeta(
    'deck3Name',
  );
  @override
  late final GeneratedColumn<String> deck3Name = GeneratedColumn<String>(
    'deck3_name',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _deck4NameMeta = const VerificationMeta(
    'deck4Name',
  );
  @override
  late final GeneratedColumn<String> deck4Name = GeneratedColumn<String>(
    'deck4_name',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [
    id,
    name,
    createdAt,
    totalSims,
    completedSims,
    state,
    deck1Name,
    deck2Name,
    deck3Name,
    deck4Name,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'jobs';
  @override
  VerificationContext validateIntegrity(
    Insertable<Job> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    }
    if (data.containsKey('name')) {
      context.handle(
        _nameMeta,
        name.isAcceptableOrUnknown(data['name']!, _nameMeta),
      );
    }
    if (data.containsKey('created_at')) {
      context.handle(
        _createdAtMeta,
        createdAt.isAcceptableOrUnknown(data['created_at']!, _createdAtMeta),
      );
    } else if (isInserting) {
      context.missing(_createdAtMeta);
    }
    if (data.containsKey('total_sims')) {
      context.handle(
        _totalSimsMeta,
        totalSims.isAcceptableOrUnknown(data['total_sims']!, _totalSimsMeta),
      );
    } else if (isInserting) {
      context.missing(_totalSimsMeta);
    }
    if (data.containsKey('completed_sims')) {
      context.handle(
        _completedSimsMeta,
        completedSims.isAcceptableOrUnknown(
          data['completed_sims']!,
          _completedSimsMeta,
        ),
      );
    }
    if (data.containsKey('state')) {
      context.handle(
        _stateMeta,
        state.isAcceptableOrUnknown(data['state']!, _stateMeta),
      );
    }
    if (data.containsKey('deck1_name')) {
      context.handle(
        _deck1NameMeta,
        deck1Name.isAcceptableOrUnknown(data['deck1_name']!, _deck1NameMeta),
      );
    } else if (isInserting) {
      context.missing(_deck1NameMeta);
    }
    if (data.containsKey('deck2_name')) {
      context.handle(
        _deck2NameMeta,
        deck2Name.isAcceptableOrUnknown(data['deck2_name']!, _deck2NameMeta),
      );
    } else if (isInserting) {
      context.missing(_deck2NameMeta);
    }
    if (data.containsKey('deck3_name')) {
      context.handle(
        _deck3NameMeta,
        deck3Name.isAcceptableOrUnknown(data['deck3_name']!, _deck3NameMeta),
      );
    } else if (isInserting) {
      context.missing(_deck3NameMeta);
    }
    if (data.containsKey('deck4_name')) {
      context.handle(
        _deck4NameMeta,
        deck4Name.isAcceptableOrUnknown(data['deck4_name']!, _deck4NameMeta),
      );
    } else if (isInserting) {
      context.missing(_deck4NameMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  Job map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return Job(
      id: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}id'],
      )!,
      name: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}name'],
      ),
      createdAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}created_at'],
      )!,
      totalSims: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}total_sims'],
      )!,
      completedSims: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}completed_sims'],
      )!,
      state: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}state'],
      )!,
      deck1Name: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}deck1_name'],
      )!,
      deck2Name: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}deck2_name'],
      )!,
      deck3Name: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}deck3_name'],
      )!,
      deck4Name: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}deck4_name'],
      )!,
    );
  }

  @override
  $JobsTable createAlias(String alias) {
    return $JobsTable(attachedDatabase, alias);
  }
}

class Job extends DataClass implements Insertable<Job> {
  final int id;
  final String? name;
  final DateTime createdAt;
  final int totalSims;
  final int completedSims;
  final String state;
  final String deck1Name;
  final String deck2Name;
  final String deck3Name;
  final String deck4Name;
  const Job({
    required this.id,
    this.name,
    required this.createdAt,
    required this.totalSims,
    required this.completedSims,
    required this.state,
    required this.deck1Name,
    required this.deck2Name,
    required this.deck3Name,
    required this.deck4Name,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<int>(id);
    if (!nullToAbsent || name != null) {
      map['name'] = Variable<String>(name);
    }
    map['created_at'] = Variable<DateTime>(createdAt);
    map['total_sims'] = Variable<int>(totalSims);
    map['completed_sims'] = Variable<int>(completedSims);
    map['state'] = Variable<String>(state);
    map['deck1_name'] = Variable<String>(deck1Name);
    map['deck2_name'] = Variable<String>(deck2Name);
    map['deck3_name'] = Variable<String>(deck3Name);
    map['deck4_name'] = Variable<String>(deck4Name);
    return map;
  }

  JobsCompanion toCompanion(bool nullToAbsent) {
    return JobsCompanion(
      id: Value(id),
      name: name == null && nullToAbsent ? const Value.absent() : Value(name),
      createdAt: Value(createdAt),
      totalSims: Value(totalSims),
      completedSims: Value(completedSims),
      state: Value(state),
      deck1Name: Value(deck1Name),
      deck2Name: Value(deck2Name),
      deck3Name: Value(deck3Name),
      deck4Name: Value(deck4Name),
    );
  }

  factory Job.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return Job(
      id: serializer.fromJson<int>(json['id']),
      name: serializer.fromJson<String?>(json['name']),
      createdAt: serializer.fromJson<DateTime>(json['createdAt']),
      totalSims: serializer.fromJson<int>(json['totalSims']),
      completedSims: serializer.fromJson<int>(json['completedSims']),
      state: serializer.fromJson<String>(json['state']),
      deck1Name: serializer.fromJson<String>(json['deck1Name']),
      deck2Name: serializer.fromJson<String>(json['deck2Name']),
      deck3Name: serializer.fromJson<String>(json['deck3Name']),
      deck4Name: serializer.fromJson<String>(json['deck4Name']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<int>(id),
      'name': serializer.toJson<String?>(name),
      'createdAt': serializer.toJson<DateTime>(createdAt),
      'totalSims': serializer.toJson<int>(totalSims),
      'completedSims': serializer.toJson<int>(completedSims),
      'state': serializer.toJson<String>(state),
      'deck1Name': serializer.toJson<String>(deck1Name),
      'deck2Name': serializer.toJson<String>(deck2Name),
      'deck3Name': serializer.toJson<String>(deck3Name),
      'deck4Name': serializer.toJson<String>(deck4Name),
    };
  }

  Job copyWith({
    int? id,
    Value<String?> name = const Value.absent(),
    DateTime? createdAt,
    int? totalSims,
    int? completedSims,
    String? state,
    String? deck1Name,
    String? deck2Name,
    String? deck3Name,
    String? deck4Name,
  }) => Job(
    id: id ?? this.id,
    name: name.present ? name.value : this.name,
    createdAt: createdAt ?? this.createdAt,
    totalSims: totalSims ?? this.totalSims,
    completedSims: completedSims ?? this.completedSims,
    state: state ?? this.state,
    deck1Name: deck1Name ?? this.deck1Name,
    deck2Name: deck2Name ?? this.deck2Name,
    deck3Name: deck3Name ?? this.deck3Name,
    deck4Name: deck4Name ?? this.deck4Name,
  );
  Job copyWithCompanion(JobsCompanion data) {
    return Job(
      id: data.id.present ? data.id.value : this.id,
      name: data.name.present ? data.name.value : this.name,
      createdAt: data.createdAt.present ? data.createdAt.value : this.createdAt,
      totalSims: data.totalSims.present ? data.totalSims.value : this.totalSims,
      completedSims: data.completedSims.present
          ? data.completedSims.value
          : this.completedSims,
      state: data.state.present ? data.state.value : this.state,
      deck1Name: data.deck1Name.present ? data.deck1Name.value : this.deck1Name,
      deck2Name: data.deck2Name.present ? data.deck2Name.value : this.deck2Name,
      deck3Name: data.deck3Name.present ? data.deck3Name.value : this.deck3Name,
      deck4Name: data.deck4Name.present ? data.deck4Name.value : this.deck4Name,
    );
  }

  @override
  String toString() {
    return (StringBuffer('Job(')
          ..write('id: $id, ')
          ..write('name: $name, ')
          ..write('createdAt: $createdAt, ')
          ..write('totalSims: $totalSims, ')
          ..write('completedSims: $completedSims, ')
          ..write('state: $state, ')
          ..write('deck1Name: $deck1Name, ')
          ..write('deck2Name: $deck2Name, ')
          ..write('deck3Name: $deck3Name, ')
          ..write('deck4Name: $deck4Name')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    id,
    name,
    createdAt,
    totalSims,
    completedSims,
    state,
    deck1Name,
    deck2Name,
    deck3Name,
    deck4Name,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is Job &&
          other.id == this.id &&
          other.name == this.name &&
          other.createdAt == this.createdAt &&
          other.totalSims == this.totalSims &&
          other.completedSims == this.completedSims &&
          other.state == this.state &&
          other.deck1Name == this.deck1Name &&
          other.deck2Name == this.deck2Name &&
          other.deck3Name == this.deck3Name &&
          other.deck4Name == this.deck4Name);
}

class JobsCompanion extends UpdateCompanion<Job> {
  final Value<int> id;
  final Value<String?> name;
  final Value<DateTime> createdAt;
  final Value<int> totalSims;
  final Value<int> completedSims;
  final Value<String> state;
  final Value<String> deck1Name;
  final Value<String> deck2Name;
  final Value<String> deck3Name;
  final Value<String> deck4Name;
  const JobsCompanion({
    this.id = const Value.absent(),
    this.name = const Value.absent(),
    this.createdAt = const Value.absent(),
    this.totalSims = const Value.absent(),
    this.completedSims = const Value.absent(),
    this.state = const Value.absent(),
    this.deck1Name = const Value.absent(),
    this.deck2Name = const Value.absent(),
    this.deck3Name = const Value.absent(),
    this.deck4Name = const Value.absent(),
  });
  JobsCompanion.insert({
    this.id = const Value.absent(),
    this.name = const Value.absent(),
    required DateTime createdAt,
    required int totalSims,
    this.completedSims = const Value.absent(),
    this.state = const Value.absent(),
    required String deck1Name,
    required String deck2Name,
    required String deck3Name,
    required String deck4Name,
  }) : createdAt = Value(createdAt),
       totalSims = Value(totalSims),
       deck1Name = Value(deck1Name),
       deck2Name = Value(deck2Name),
       deck3Name = Value(deck3Name),
       deck4Name = Value(deck4Name);
  static Insertable<Job> custom({
    Expression<int>? id,
    Expression<String>? name,
    Expression<DateTime>? createdAt,
    Expression<int>? totalSims,
    Expression<int>? completedSims,
    Expression<String>? state,
    Expression<String>? deck1Name,
    Expression<String>? deck2Name,
    Expression<String>? deck3Name,
    Expression<String>? deck4Name,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (name != null) 'name': name,
      if (createdAt != null) 'created_at': createdAt,
      if (totalSims != null) 'total_sims': totalSims,
      if (completedSims != null) 'completed_sims': completedSims,
      if (state != null) 'state': state,
      if (deck1Name != null) 'deck1_name': deck1Name,
      if (deck2Name != null) 'deck2_name': deck2Name,
      if (deck3Name != null) 'deck3_name': deck3Name,
      if (deck4Name != null) 'deck4_name': deck4Name,
    });
  }

  JobsCompanion copyWith({
    Value<int>? id,
    Value<String?>? name,
    Value<DateTime>? createdAt,
    Value<int>? totalSims,
    Value<int>? completedSims,
    Value<String>? state,
    Value<String>? deck1Name,
    Value<String>? deck2Name,
    Value<String>? deck3Name,
    Value<String>? deck4Name,
  }) {
    return JobsCompanion(
      id: id ?? this.id,
      name: name ?? this.name,
      createdAt: createdAt ?? this.createdAt,
      totalSims: totalSims ?? this.totalSims,
      completedSims: completedSims ?? this.completedSims,
      state: state ?? this.state,
      deck1Name: deck1Name ?? this.deck1Name,
      deck2Name: deck2Name ?? this.deck2Name,
      deck3Name: deck3Name ?? this.deck3Name,
      deck4Name: deck4Name ?? this.deck4Name,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<int>(id.value);
    }
    if (name.present) {
      map['name'] = Variable<String>(name.value);
    }
    if (createdAt.present) {
      map['created_at'] = Variable<DateTime>(createdAt.value);
    }
    if (totalSims.present) {
      map['total_sims'] = Variable<int>(totalSims.value);
    }
    if (completedSims.present) {
      map['completed_sims'] = Variable<int>(completedSims.value);
    }
    if (state.present) {
      map['state'] = Variable<String>(state.value);
    }
    if (deck1Name.present) {
      map['deck1_name'] = Variable<String>(deck1Name.value);
    }
    if (deck2Name.present) {
      map['deck2_name'] = Variable<String>(deck2Name.value);
    }
    if (deck3Name.present) {
      map['deck3_name'] = Variable<String>(deck3Name.value);
    }
    if (deck4Name.present) {
      map['deck4_name'] = Variable<String>(deck4Name.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('JobsCompanion(')
          ..write('id: $id, ')
          ..write('name: $name, ')
          ..write('createdAt: $createdAt, ')
          ..write('totalSims: $totalSims, ')
          ..write('completedSims: $completedSims, ')
          ..write('state: $state, ')
          ..write('deck1Name: $deck1Name, ')
          ..write('deck2Name: $deck2Name, ')
          ..write('deck3Name: $deck3Name, ')
          ..write('deck4Name: $deck4Name')
          ..write(')'))
        .toString();
  }
}

class $SimsTable extends Sims with TableInfo<$SimsTable, Sim> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $SimsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<int> id = GeneratedColumn<int>(
    'id',
    aliasedName,
    false,
    hasAutoIncrement: true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'PRIMARY KEY AUTOINCREMENT',
    ),
  );
  static const VerificationMeta _jobIdMeta = const VerificationMeta('jobId');
  @override
  late final GeneratedColumn<int> jobId = GeneratedColumn<int>(
    'job_id',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'REFERENCES jobs (id)',
    ),
  );
  static const VerificationMeta _simIndexMeta = const VerificationMeta(
    'simIndex',
  );
  @override
  late final GeneratedColumn<int> simIndex = GeneratedColumn<int>(
    'sim_index',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _stateMeta = const VerificationMeta('state');
  @override
  late final GeneratedColumn<String> state = GeneratedColumn<String>(
    'state',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant('PENDING'),
  );
  static const VerificationMeta _winnerDeckNameMeta = const VerificationMeta(
    'winnerDeckName',
  );
  @override
  late final GeneratedColumn<String> winnerDeckName = GeneratedColumn<String>(
    'winner_deck_name',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _winningTurnMeta = const VerificationMeta(
    'winningTurn',
  );
  @override
  late final GeneratedColumn<int> winningTurn = GeneratedColumn<int>(
    'winning_turn',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _durationMsMeta = const VerificationMeta(
    'durationMs',
  );
  @override
  late final GeneratedColumn<int> durationMs = GeneratedColumn<int>(
    'duration_ms',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _errorMessageMeta = const VerificationMeta(
    'errorMessage',
  );
  @override
  late final GeneratedColumn<String> errorMessage = GeneratedColumn<String>(
    'error_message',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _logRelPathMeta = const VerificationMeta(
    'logRelPath',
  );
  @override
  late final GeneratedColumn<String> logRelPath = GeneratedColumn<String>(
    'log_rel_path',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _startedAtMeta = const VerificationMeta(
    'startedAt',
  );
  @override
  late final GeneratedColumn<DateTime> startedAt = GeneratedColumn<DateTime>(
    'started_at',
    aliasedName,
    true,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _completedAtMeta = const VerificationMeta(
    'completedAt',
  );
  @override
  late final GeneratedColumn<DateTime> completedAt = GeneratedColumn<DateTime>(
    'completed_at',
    aliasedName,
    true,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: false,
  );
  @override
  List<GeneratedColumn> get $columns => [
    id,
    jobId,
    simIndex,
    state,
    winnerDeckName,
    winningTurn,
    durationMs,
    errorMessage,
    logRelPath,
    startedAt,
    completedAt,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'sims';
  @override
  VerificationContext validateIntegrity(
    Insertable<Sim> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    }
    if (data.containsKey('job_id')) {
      context.handle(
        _jobIdMeta,
        jobId.isAcceptableOrUnknown(data['job_id']!, _jobIdMeta),
      );
    } else if (isInserting) {
      context.missing(_jobIdMeta);
    }
    if (data.containsKey('sim_index')) {
      context.handle(
        _simIndexMeta,
        simIndex.isAcceptableOrUnknown(data['sim_index']!, _simIndexMeta),
      );
    } else if (isInserting) {
      context.missing(_simIndexMeta);
    }
    if (data.containsKey('state')) {
      context.handle(
        _stateMeta,
        state.isAcceptableOrUnknown(data['state']!, _stateMeta),
      );
    }
    if (data.containsKey('winner_deck_name')) {
      context.handle(
        _winnerDeckNameMeta,
        winnerDeckName.isAcceptableOrUnknown(
          data['winner_deck_name']!,
          _winnerDeckNameMeta,
        ),
      );
    }
    if (data.containsKey('winning_turn')) {
      context.handle(
        _winningTurnMeta,
        winningTurn.isAcceptableOrUnknown(
          data['winning_turn']!,
          _winningTurnMeta,
        ),
      );
    }
    if (data.containsKey('duration_ms')) {
      context.handle(
        _durationMsMeta,
        durationMs.isAcceptableOrUnknown(data['duration_ms']!, _durationMsMeta),
      );
    }
    if (data.containsKey('error_message')) {
      context.handle(
        _errorMessageMeta,
        errorMessage.isAcceptableOrUnknown(
          data['error_message']!,
          _errorMessageMeta,
        ),
      );
    }
    if (data.containsKey('log_rel_path')) {
      context.handle(
        _logRelPathMeta,
        logRelPath.isAcceptableOrUnknown(
          data['log_rel_path']!,
          _logRelPathMeta,
        ),
      );
    }
    if (data.containsKey('started_at')) {
      context.handle(
        _startedAtMeta,
        startedAt.isAcceptableOrUnknown(data['started_at']!, _startedAtMeta),
      );
    }
    if (data.containsKey('completed_at')) {
      context.handle(
        _completedAtMeta,
        completedAt.isAcceptableOrUnknown(
          data['completed_at']!,
          _completedAtMeta,
        ),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  Sim map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return Sim(
      id: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}id'],
      )!,
      jobId: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}job_id'],
      )!,
      simIndex: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}sim_index'],
      )!,
      state: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}state'],
      )!,
      winnerDeckName: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}winner_deck_name'],
      ),
      winningTurn: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}winning_turn'],
      ),
      durationMs: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}duration_ms'],
      ),
      errorMessage: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}error_message'],
      ),
      logRelPath: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}log_rel_path'],
      ),
      startedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}started_at'],
      ),
      completedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}completed_at'],
      ),
    );
  }

  @override
  $SimsTable createAlias(String alias) {
    return $SimsTable(attachedDatabase, alias);
  }
}

class Sim extends DataClass implements Insertable<Sim> {
  final int id;
  final int jobId;
  final int simIndex;
  final String state;
  final String? winnerDeckName;
  final int? winningTurn;
  final int? durationMs;
  final String? errorMessage;
  final String? logRelPath;
  final DateTime? startedAt;
  final DateTime? completedAt;
  const Sim({
    required this.id,
    required this.jobId,
    required this.simIndex,
    required this.state,
    this.winnerDeckName,
    this.winningTurn,
    this.durationMs,
    this.errorMessage,
    this.logRelPath,
    this.startedAt,
    this.completedAt,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<int>(id);
    map['job_id'] = Variable<int>(jobId);
    map['sim_index'] = Variable<int>(simIndex);
    map['state'] = Variable<String>(state);
    if (!nullToAbsent || winnerDeckName != null) {
      map['winner_deck_name'] = Variable<String>(winnerDeckName);
    }
    if (!nullToAbsent || winningTurn != null) {
      map['winning_turn'] = Variable<int>(winningTurn);
    }
    if (!nullToAbsent || durationMs != null) {
      map['duration_ms'] = Variable<int>(durationMs);
    }
    if (!nullToAbsent || errorMessage != null) {
      map['error_message'] = Variable<String>(errorMessage);
    }
    if (!nullToAbsent || logRelPath != null) {
      map['log_rel_path'] = Variable<String>(logRelPath);
    }
    if (!nullToAbsent || startedAt != null) {
      map['started_at'] = Variable<DateTime>(startedAt);
    }
    if (!nullToAbsent || completedAt != null) {
      map['completed_at'] = Variable<DateTime>(completedAt);
    }
    return map;
  }

  SimsCompanion toCompanion(bool nullToAbsent) {
    return SimsCompanion(
      id: Value(id),
      jobId: Value(jobId),
      simIndex: Value(simIndex),
      state: Value(state),
      winnerDeckName: winnerDeckName == null && nullToAbsent
          ? const Value.absent()
          : Value(winnerDeckName),
      winningTurn: winningTurn == null && nullToAbsent
          ? const Value.absent()
          : Value(winningTurn),
      durationMs: durationMs == null && nullToAbsent
          ? const Value.absent()
          : Value(durationMs),
      errorMessage: errorMessage == null && nullToAbsent
          ? const Value.absent()
          : Value(errorMessage),
      logRelPath: logRelPath == null && nullToAbsent
          ? const Value.absent()
          : Value(logRelPath),
      startedAt: startedAt == null && nullToAbsent
          ? const Value.absent()
          : Value(startedAt),
      completedAt: completedAt == null && nullToAbsent
          ? const Value.absent()
          : Value(completedAt),
    );
  }

  factory Sim.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return Sim(
      id: serializer.fromJson<int>(json['id']),
      jobId: serializer.fromJson<int>(json['jobId']),
      simIndex: serializer.fromJson<int>(json['simIndex']),
      state: serializer.fromJson<String>(json['state']),
      winnerDeckName: serializer.fromJson<String?>(json['winnerDeckName']),
      winningTurn: serializer.fromJson<int?>(json['winningTurn']),
      durationMs: serializer.fromJson<int?>(json['durationMs']),
      errorMessage: serializer.fromJson<String?>(json['errorMessage']),
      logRelPath: serializer.fromJson<String?>(json['logRelPath']),
      startedAt: serializer.fromJson<DateTime?>(json['startedAt']),
      completedAt: serializer.fromJson<DateTime?>(json['completedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<int>(id),
      'jobId': serializer.toJson<int>(jobId),
      'simIndex': serializer.toJson<int>(simIndex),
      'state': serializer.toJson<String>(state),
      'winnerDeckName': serializer.toJson<String?>(winnerDeckName),
      'winningTurn': serializer.toJson<int?>(winningTurn),
      'durationMs': serializer.toJson<int?>(durationMs),
      'errorMessage': serializer.toJson<String?>(errorMessage),
      'logRelPath': serializer.toJson<String?>(logRelPath),
      'startedAt': serializer.toJson<DateTime?>(startedAt),
      'completedAt': serializer.toJson<DateTime?>(completedAt),
    };
  }

  Sim copyWith({
    int? id,
    int? jobId,
    int? simIndex,
    String? state,
    Value<String?> winnerDeckName = const Value.absent(),
    Value<int?> winningTurn = const Value.absent(),
    Value<int?> durationMs = const Value.absent(),
    Value<String?> errorMessage = const Value.absent(),
    Value<String?> logRelPath = const Value.absent(),
    Value<DateTime?> startedAt = const Value.absent(),
    Value<DateTime?> completedAt = const Value.absent(),
  }) => Sim(
    id: id ?? this.id,
    jobId: jobId ?? this.jobId,
    simIndex: simIndex ?? this.simIndex,
    state: state ?? this.state,
    winnerDeckName: winnerDeckName.present
        ? winnerDeckName.value
        : this.winnerDeckName,
    winningTurn: winningTurn.present ? winningTurn.value : this.winningTurn,
    durationMs: durationMs.present ? durationMs.value : this.durationMs,
    errorMessage: errorMessage.present ? errorMessage.value : this.errorMessage,
    logRelPath: logRelPath.present ? logRelPath.value : this.logRelPath,
    startedAt: startedAt.present ? startedAt.value : this.startedAt,
    completedAt: completedAt.present ? completedAt.value : this.completedAt,
  );
  Sim copyWithCompanion(SimsCompanion data) {
    return Sim(
      id: data.id.present ? data.id.value : this.id,
      jobId: data.jobId.present ? data.jobId.value : this.jobId,
      simIndex: data.simIndex.present ? data.simIndex.value : this.simIndex,
      state: data.state.present ? data.state.value : this.state,
      winnerDeckName: data.winnerDeckName.present
          ? data.winnerDeckName.value
          : this.winnerDeckName,
      winningTurn: data.winningTurn.present
          ? data.winningTurn.value
          : this.winningTurn,
      durationMs: data.durationMs.present
          ? data.durationMs.value
          : this.durationMs,
      errorMessage: data.errorMessage.present
          ? data.errorMessage.value
          : this.errorMessage,
      logRelPath: data.logRelPath.present
          ? data.logRelPath.value
          : this.logRelPath,
      startedAt: data.startedAt.present ? data.startedAt.value : this.startedAt,
      completedAt: data.completedAt.present
          ? data.completedAt.value
          : this.completedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('Sim(')
          ..write('id: $id, ')
          ..write('jobId: $jobId, ')
          ..write('simIndex: $simIndex, ')
          ..write('state: $state, ')
          ..write('winnerDeckName: $winnerDeckName, ')
          ..write('winningTurn: $winningTurn, ')
          ..write('durationMs: $durationMs, ')
          ..write('errorMessage: $errorMessage, ')
          ..write('logRelPath: $logRelPath, ')
          ..write('startedAt: $startedAt, ')
          ..write('completedAt: $completedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    id,
    jobId,
    simIndex,
    state,
    winnerDeckName,
    winningTurn,
    durationMs,
    errorMessage,
    logRelPath,
    startedAt,
    completedAt,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is Sim &&
          other.id == this.id &&
          other.jobId == this.jobId &&
          other.simIndex == this.simIndex &&
          other.state == this.state &&
          other.winnerDeckName == this.winnerDeckName &&
          other.winningTurn == this.winningTurn &&
          other.durationMs == this.durationMs &&
          other.errorMessage == this.errorMessage &&
          other.logRelPath == this.logRelPath &&
          other.startedAt == this.startedAt &&
          other.completedAt == this.completedAt);
}

class SimsCompanion extends UpdateCompanion<Sim> {
  final Value<int> id;
  final Value<int> jobId;
  final Value<int> simIndex;
  final Value<String> state;
  final Value<String?> winnerDeckName;
  final Value<int?> winningTurn;
  final Value<int?> durationMs;
  final Value<String?> errorMessage;
  final Value<String?> logRelPath;
  final Value<DateTime?> startedAt;
  final Value<DateTime?> completedAt;
  const SimsCompanion({
    this.id = const Value.absent(),
    this.jobId = const Value.absent(),
    this.simIndex = const Value.absent(),
    this.state = const Value.absent(),
    this.winnerDeckName = const Value.absent(),
    this.winningTurn = const Value.absent(),
    this.durationMs = const Value.absent(),
    this.errorMessage = const Value.absent(),
    this.logRelPath = const Value.absent(),
    this.startedAt = const Value.absent(),
    this.completedAt = const Value.absent(),
  });
  SimsCompanion.insert({
    this.id = const Value.absent(),
    required int jobId,
    required int simIndex,
    this.state = const Value.absent(),
    this.winnerDeckName = const Value.absent(),
    this.winningTurn = const Value.absent(),
    this.durationMs = const Value.absent(),
    this.errorMessage = const Value.absent(),
    this.logRelPath = const Value.absent(),
    this.startedAt = const Value.absent(),
    this.completedAt = const Value.absent(),
  }) : jobId = Value(jobId),
       simIndex = Value(simIndex);
  static Insertable<Sim> custom({
    Expression<int>? id,
    Expression<int>? jobId,
    Expression<int>? simIndex,
    Expression<String>? state,
    Expression<String>? winnerDeckName,
    Expression<int>? winningTurn,
    Expression<int>? durationMs,
    Expression<String>? errorMessage,
    Expression<String>? logRelPath,
    Expression<DateTime>? startedAt,
    Expression<DateTime>? completedAt,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (jobId != null) 'job_id': jobId,
      if (simIndex != null) 'sim_index': simIndex,
      if (state != null) 'state': state,
      if (winnerDeckName != null) 'winner_deck_name': winnerDeckName,
      if (winningTurn != null) 'winning_turn': winningTurn,
      if (durationMs != null) 'duration_ms': durationMs,
      if (errorMessage != null) 'error_message': errorMessage,
      if (logRelPath != null) 'log_rel_path': logRelPath,
      if (startedAt != null) 'started_at': startedAt,
      if (completedAt != null) 'completed_at': completedAt,
    });
  }

  SimsCompanion copyWith({
    Value<int>? id,
    Value<int>? jobId,
    Value<int>? simIndex,
    Value<String>? state,
    Value<String?>? winnerDeckName,
    Value<int?>? winningTurn,
    Value<int?>? durationMs,
    Value<String?>? errorMessage,
    Value<String?>? logRelPath,
    Value<DateTime?>? startedAt,
    Value<DateTime?>? completedAt,
  }) {
    return SimsCompanion(
      id: id ?? this.id,
      jobId: jobId ?? this.jobId,
      simIndex: simIndex ?? this.simIndex,
      state: state ?? this.state,
      winnerDeckName: winnerDeckName ?? this.winnerDeckName,
      winningTurn: winningTurn ?? this.winningTurn,
      durationMs: durationMs ?? this.durationMs,
      errorMessage: errorMessage ?? this.errorMessage,
      logRelPath: logRelPath ?? this.logRelPath,
      startedAt: startedAt ?? this.startedAt,
      completedAt: completedAt ?? this.completedAt,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<int>(id.value);
    }
    if (jobId.present) {
      map['job_id'] = Variable<int>(jobId.value);
    }
    if (simIndex.present) {
      map['sim_index'] = Variable<int>(simIndex.value);
    }
    if (state.present) {
      map['state'] = Variable<String>(state.value);
    }
    if (winnerDeckName.present) {
      map['winner_deck_name'] = Variable<String>(winnerDeckName.value);
    }
    if (winningTurn.present) {
      map['winning_turn'] = Variable<int>(winningTurn.value);
    }
    if (durationMs.present) {
      map['duration_ms'] = Variable<int>(durationMs.value);
    }
    if (errorMessage.present) {
      map['error_message'] = Variable<String>(errorMessage.value);
    }
    if (logRelPath.present) {
      map['log_rel_path'] = Variable<String>(logRelPath.value);
    }
    if (startedAt.present) {
      map['started_at'] = Variable<DateTime>(startedAt.value);
    }
    if (completedAt.present) {
      map['completed_at'] = Variable<DateTime>(completedAt.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('SimsCompanion(')
          ..write('id: $id, ')
          ..write('jobId: $jobId, ')
          ..write('simIndex: $simIndex, ')
          ..write('state: $state, ')
          ..write('winnerDeckName: $winnerDeckName, ')
          ..write('winningTurn: $winningTurn, ')
          ..write('durationMs: $durationMs, ')
          ..write('errorMessage: $errorMessage, ')
          ..write('logRelPath: $logRelPath, ')
          ..write('startedAt: $startedAt, ')
          ..write('completedAt: $completedAt')
          ..write(')'))
        .toString();
  }
}

class $SettingsTable extends Settings with TableInfo<$SettingsTable, Setting> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $SettingsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _keyMeta = const VerificationMeta('key');
  @override
  late final GeneratedColumn<String> key = GeneratedColumn<String>(
    'key',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _valueMeta = const VerificationMeta('value');
  @override
  late final GeneratedColumn<String> value = GeneratedColumn<String>(
    'value',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [key, value];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'settings';
  @override
  VerificationContext validateIntegrity(
    Insertable<Setting> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('key')) {
      context.handle(
        _keyMeta,
        key.isAcceptableOrUnknown(data['key']!, _keyMeta),
      );
    } else if (isInserting) {
      context.missing(_keyMeta);
    }
    if (data.containsKey('value')) {
      context.handle(
        _valueMeta,
        value.isAcceptableOrUnknown(data['value']!, _valueMeta),
      );
    } else if (isInserting) {
      context.missing(_valueMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {key};
  @override
  Setting map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return Setting(
      key: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}key'],
      )!,
      value: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}value'],
      )!,
    );
  }

  @override
  $SettingsTable createAlias(String alias) {
    return $SettingsTable(attachedDatabase, alias);
  }
}

class Setting extends DataClass implements Insertable<Setting> {
  final String key;
  final String value;
  const Setting({required this.key, required this.value});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['key'] = Variable<String>(key);
    map['value'] = Variable<String>(value);
    return map;
  }

  SettingsCompanion toCompanion(bool nullToAbsent) {
    return SettingsCompanion(key: Value(key), value: Value(value));
  }

  factory Setting.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return Setting(
      key: serializer.fromJson<String>(json['key']),
      value: serializer.fromJson<String>(json['value']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'key': serializer.toJson<String>(key),
      'value': serializer.toJson<String>(value),
    };
  }

  Setting copyWith({String? key, String? value}) =>
      Setting(key: key ?? this.key, value: value ?? this.value);
  Setting copyWithCompanion(SettingsCompanion data) {
    return Setting(
      key: data.key.present ? data.key.value : this.key,
      value: data.value.present ? data.value.value : this.value,
    );
  }

  @override
  String toString() {
    return (StringBuffer('Setting(')
          ..write('key: $key, ')
          ..write('value: $value')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(key, value);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is Setting && other.key == this.key && other.value == this.value);
}

class SettingsCompanion extends UpdateCompanion<Setting> {
  final Value<String> key;
  final Value<String> value;
  final Value<int> rowid;
  const SettingsCompanion({
    this.key = const Value.absent(),
    this.value = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  SettingsCompanion.insert({
    required String key,
    required String value,
    this.rowid = const Value.absent(),
  }) : key = Value(key),
       value = Value(value);
  static Insertable<Setting> custom({
    Expression<String>? key,
    Expression<String>? value,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (key != null) 'key': key,
      if (value != null) 'value': value,
      if (rowid != null) 'rowid': rowid,
    });
  }

  SettingsCompanion copyWith({
    Value<String>? key,
    Value<String>? value,
    Value<int>? rowid,
  }) {
    return SettingsCompanion(
      key: key ?? this.key,
      value: value ?? this.value,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (key.present) {
      map['key'] = Variable<String>(key.value);
    }
    if (value.present) {
      map['value'] = Variable<String>(value.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('SettingsCompanion(')
          ..write('key: $key, ')
          ..write('value: $value, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

abstract class _$AppDb extends GeneratedDatabase {
  _$AppDb(QueryExecutor e) : super(e);
  $AppDbManager get managers => $AppDbManager(this);
  late final $JobsTable jobs = $JobsTable(this);
  late final $SimsTable sims = $SimsTable(this);
  late final $SettingsTable settings = $SettingsTable(this);
  @override
  Iterable<TableInfo<Table, Object?>> get allTables =>
      allSchemaEntities.whereType<TableInfo<Table, Object?>>();
  @override
  List<DatabaseSchemaEntity> get allSchemaEntities => [jobs, sims, settings];
}

typedef $$JobsTableCreateCompanionBuilder =
    JobsCompanion Function({
      Value<int> id,
      Value<String?> name,
      required DateTime createdAt,
      required int totalSims,
      Value<int> completedSims,
      Value<String> state,
      required String deck1Name,
      required String deck2Name,
      required String deck3Name,
      required String deck4Name,
    });
typedef $$JobsTableUpdateCompanionBuilder =
    JobsCompanion Function({
      Value<int> id,
      Value<String?> name,
      Value<DateTime> createdAt,
      Value<int> totalSims,
      Value<int> completedSims,
      Value<String> state,
      Value<String> deck1Name,
      Value<String> deck2Name,
      Value<String> deck3Name,
      Value<String> deck4Name,
    });

final class $$JobsTableReferences
    extends BaseReferences<_$AppDb, $JobsTable, Job> {
  $$JobsTableReferences(super.$_db, super.$_table, super.$_typedResult);

  static MultiTypedResultKey<$SimsTable, List<Sim>> _simsRefsTable(
    _$AppDb db,
  ) => MultiTypedResultKey.fromTable(
    db.sims,
    aliasName: $_aliasNameGenerator(db.jobs.id, db.sims.jobId),
  );

  $$SimsTableProcessedTableManager get simsRefs {
    final manager = $$SimsTableTableManager(
      $_db,
      $_db.sims,
    ).filter((f) => f.jobId.id.sqlEquals($_itemColumn<int>('id')!));

    final cache = $_typedResult.readTableOrNull(_simsRefsTable($_db));
    return ProcessedTableManager(
      manager.$state.copyWith(prefetchedData: cache),
    );
  }
}

class $$JobsTableFilterComposer extends Composer<_$AppDb, $JobsTable> {
  $$JobsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<int> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get name => $composableBuilder(
    column: $table.name,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get createdAt => $composableBuilder(
    column: $table.createdAt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get totalSims => $composableBuilder(
    column: $table.totalSims,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get completedSims => $composableBuilder(
    column: $table.completedSims,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get state => $composableBuilder(
    column: $table.state,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get deck1Name => $composableBuilder(
    column: $table.deck1Name,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get deck2Name => $composableBuilder(
    column: $table.deck2Name,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get deck3Name => $composableBuilder(
    column: $table.deck3Name,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get deck4Name => $composableBuilder(
    column: $table.deck4Name,
    builder: (column) => ColumnFilters(column),
  );

  Expression<bool> simsRefs(
    Expression<bool> Function($$SimsTableFilterComposer f) f,
  ) {
    final $$SimsTableFilterComposer composer = $composerBuilder(
      composer: this,
      getCurrentColumn: (t) => t.id,
      referencedTable: $db.sims,
      getReferencedColumn: (t) => t.jobId,
      builder:
          (
            joinBuilder, {
            $addJoinBuilderToRootComposer,
            $removeJoinBuilderFromRootComposer,
          }) => $$SimsTableFilterComposer(
            $db: $db,
            $table: $db.sims,
            $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
            joinBuilder: joinBuilder,
            $removeJoinBuilderFromRootComposer:
                $removeJoinBuilderFromRootComposer,
          ),
    );
    return f(composer);
  }
}

class $$JobsTableOrderingComposer extends Composer<_$AppDb, $JobsTable> {
  $$JobsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<int> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get name => $composableBuilder(
    column: $table.name,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get createdAt => $composableBuilder(
    column: $table.createdAt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get totalSims => $composableBuilder(
    column: $table.totalSims,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get completedSims => $composableBuilder(
    column: $table.completedSims,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get state => $composableBuilder(
    column: $table.state,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get deck1Name => $composableBuilder(
    column: $table.deck1Name,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get deck2Name => $composableBuilder(
    column: $table.deck2Name,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get deck3Name => $composableBuilder(
    column: $table.deck3Name,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get deck4Name => $composableBuilder(
    column: $table.deck4Name,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$JobsTableAnnotationComposer extends Composer<_$AppDb, $JobsTable> {
  $$JobsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<int> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get name =>
      $composableBuilder(column: $table.name, builder: (column) => column);

  GeneratedColumn<DateTime> get createdAt =>
      $composableBuilder(column: $table.createdAt, builder: (column) => column);

  GeneratedColumn<int> get totalSims =>
      $composableBuilder(column: $table.totalSims, builder: (column) => column);

  GeneratedColumn<int> get completedSims => $composableBuilder(
    column: $table.completedSims,
    builder: (column) => column,
  );

  GeneratedColumn<String> get state =>
      $composableBuilder(column: $table.state, builder: (column) => column);

  GeneratedColumn<String> get deck1Name =>
      $composableBuilder(column: $table.deck1Name, builder: (column) => column);

  GeneratedColumn<String> get deck2Name =>
      $composableBuilder(column: $table.deck2Name, builder: (column) => column);

  GeneratedColumn<String> get deck3Name =>
      $composableBuilder(column: $table.deck3Name, builder: (column) => column);

  GeneratedColumn<String> get deck4Name =>
      $composableBuilder(column: $table.deck4Name, builder: (column) => column);

  Expression<T> simsRefs<T extends Object>(
    Expression<T> Function($$SimsTableAnnotationComposer a) f,
  ) {
    final $$SimsTableAnnotationComposer composer = $composerBuilder(
      composer: this,
      getCurrentColumn: (t) => t.id,
      referencedTable: $db.sims,
      getReferencedColumn: (t) => t.jobId,
      builder:
          (
            joinBuilder, {
            $addJoinBuilderToRootComposer,
            $removeJoinBuilderFromRootComposer,
          }) => $$SimsTableAnnotationComposer(
            $db: $db,
            $table: $db.sims,
            $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
            joinBuilder: joinBuilder,
            $removeJoinBuilderFromRootComposer:
                $removeJoinBuilderFromRootComposer,
          ),
    );
    return f(composer);
  }
}

class $$JobsTableTableManager
    extends
        RootTableManager<
          _$AppDb,
          $JobsTable,
          Job,
          $$JobsTableFilterComposer,
          $$JobsTableOrderingComposer,
          $$JobsTableAnnotationComposer,
          $$JobsTableCreateCompanionBuilder,
          $$JobsTableUpdateCompanionBuilder,
          (Job, $$JobsTableReferences),
          Job,
          PrefetchHooks Function({bool simsRefs})
        > {
  $$JobsTableTableManager(_$AppDb db, $JobsTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$JobsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$JobsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$JobsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<int> id = const Value.absent(),
                Value<String?> name = const Value.absent(),
                Value<DateTime> createdAt = const Value.absent(),
                Value<int> totalSims = const Value.absent(),
                Value<int> completedSims = const Value.absent(),
                Value<String> state = const Value.absent(),
                Value<String> deck1Name = const Value.absent(),
                Value<String> deck2Name = const Value.absent(),
                Value<String> deck3Name = const Value.absent(),
                Value<String> deck4Name = const Value.absent(),
              }) => JobsCompanion(
                id: id,
                name: name,
                createdAt: createdAt,
                totalSims: totalSims,
                completedSims: completedSims,
                state: state,
                deck1Name: deck1Name,
                deck2Name: deck2Name,
                deck3Name: deck3Name,
                deck4Name: deck4Name,
              ),
          createCompanionCallback:
              ({
                Value<int> id = const Value.absent(),
                Value<String?> name = const Value.absent(),
                required DateTime createdAt,
                required int totalSims,
                Value<int> completedSims = const Value.absent(),
                Value<String> state = const Value.absent(),
                required String deck1Name,
                required String deck2Name,
                required String deck3Name,
                required String deck4Name,
              }) => JobsCompanion.insert(
                id: id,
                name: name,
                createdAt: createdAt,
                totalSims: totalSims,
                completedSims: completedSims,
                state: state,
                deck1Name: deck1Name,
                deck2Name: deck2Name,
                deck3Name: deck3Name,
                deck4Name: deck4Name,
              ),
          withReferenceMapper: (p0) => p0
              .map(
                (e) =>
                    (e.readTable(table), $$JobsTableReferences(db, table, e)),
              )
              .toList(),
          prefetchHooksCallback: ({simsRefs = false}) {
            return PrefetchHooks(
              db: db,
              explicitlyWatchedTables: [if (simsRefs) db.sims],
              addJoins: null,
              getPrefetchedDataCallback: (items) async {
                return [
                  if (simsRefs)
                    await $_getPrefetchedData<Job, $JobsTable, Sim>(
                      currentTable: table,
                      referencedTable: $$JobsTableReferences._simsRefsTable(db),
                      managerFromTypedResult: (p0) =>
                          $$JobsTableReferences(db, table, p0).simsRefs,
                      referencedItemsForCurrentItem: (item, referencedItems) =>
                          referencedItems.where((e) => e.jobId == item.id),
                      typedResults: items,
                    ),
                ];
              },
            );
          },
        ),
      );
}

typedef $$JobsTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDb,
      $JobsTable,
      Job,
      $$JobsTableFilterComposer,
      $$JobsTableOrderingComposer,
      $$JobsTableAnnotationComposer,
      $$JobsTableCreateCompanionBuilder,
      $$JobsTableUpdateCompanionBuilder,
      (Job, $$JobsTableReferences),
      Job,
      PrefetchHooks Function({bool simsRefs})
    >;
typedef $$SimsTableCreateCompanionBuilder =
    SimsCompanion Function({
      Value<int> id,
      required int jobId,
      required int simIndex,
      Value<String> state,
      Value<String?> winnerDeckName,
      Value<int?> winningTurn,
      Value<int?> durationMs,
      Value<String?> errorMessage,
      Value<String?> logRelPath,
      Value<DateTime?> startedAt,
      Value<DateTime?> completedAt,
    });
typedef $$SimsTableUpdateCompanionBuilder =
    SimsCompanion Function({
      Value<int> id,
      Value<int> jobId,
      Value<int> simIndex,
      Value<String> state,
      Value<String?> winnerDeckName,
      Value<int?> winningTurn,
      Value<int?> durationMs,
      Value<String?> errorMessage,
      Value<String?> logRelPath,
      Value<DateTime?> startedAt,
      Value<DateTime?> completedAt,
    });

final class $$SimsTableReferences
    extends BaseReferences<_$AppDb, $SimsTable, Sim> {
  $$SimsTableReferences(super.$_db, super.$_table, super.$_typedResult);

  static $JobsTable _jobIdTable(_$AppDb db) =>
      db.jobs.createAlias($_aliasNameGenerator(db.sims.jobId, db.jobs.id));

  $$JobsTableProcessedTableManager get jobId {
    final $_column = $_itemColumn<int>('job_id')!;

    final manager = $$JobsTableTableManager(
      $_db,
      $_db.jobs,
    ).filter((f) => f.id.sqlEquals($_column));
    final item = $_typedResult.readTableOrNull(_jobIdTable($_db));
    if (item == null) return manager;
    return ProcessedTableManager(
      manager.$state.copyWith(prefetchedData: [item]),
    );
  }
}

class $$SimsTableFilterComposer extends Composer<_$AppDb, $SimsTable> {
  $$SimsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<int> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get simIndex => $composableBuilder(
    column: $table.simIndex,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get state => $composableBuilder(
    column: $table.state,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get winnerDeckName => $composableBuilder(
    column: $table.winnerDeckName,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get winningTurn => $composableBuilder(
    column: $table.winningTurn,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get durationMs => $composableBuilder(
    column: $table.durationMs,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get errorMessage => $composableBuilder(
    column: $table.errorMessage,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get logRelPath => $composableBuilder(
    column: $table.logRelPath,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get startedAt => $composableBuilder(
    column: $table.startedAt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get completedAt => $composableBuilder(
    column: $table.completedAt,
    builder: (column) => ColumnFilters(column),
  );

  $$JobsTableFilterComposer get jobId {
    final $$JobsTableFilterComposer composer = $composerBuilder(
      composer: this,
      getCurrentColumn: (t) => t.jobId,
      referencedTable: $db.jobs,
      getReferencedColumn: (t) => t.id,
      builder:
          (
            joinBuilder, {
            $addJoinBuilderToRootComposer,
            $removeJoinBuilderFromRootComposer,
          }) => $$JobsTableFilterComposer(
            $db: $db,
            $table: $db.jobs,
            $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
            joinBuilder: joinBuilder,
            $removeJoinBuilderFromRootComposer:
                $removeJoinBuilderFromRootComposer,
          ),
    );
    return composer;
  }
}

class $$SimsTableOrderingComposer extends Composer<_$AppDb, $SimsTable> {
  $$SimsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<int> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get simIndex => $composableBuilder(
    column: $table.simIndex,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get state => $composableBuilder(
    column: $table.state,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get winnerDeckName => $composableBuilder(
    column: $table.winnerDeckName,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get winningTurn => $composableBuilder(
    column: $table.winningTurn,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get durationMs => $composableBuilder(
    column: $table.durationMs,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get errorMessage => $composableBuilder(
    column: $table.errorMessage,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get logRelPath => $composableBuilder(
    column: $table.logRelPath,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get startedAt => $composableBuilder(
    column: $table.startedAt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get completedAt => $composableBuilder(
    column: $table.completedAt,
    builder: (column) => ColumnOrderings(column),
  );

  $$JobsTableOrderingComposer get jobId {
    final $$JobsTableOrderingComposer composer = $composerBuilder(
      composer: this,
      getCurrentColumn: (t) => t.jobId,
      referencedTable: $db.jobs,
      getReferencedColumn: (t) => t.id,
      builder:
          (
            joinBuilder, {
            $addJoinBuilderToRootComposer,
            $removeJoinBuilderFromRootComposer,
          }) => $$JobsTableOrderingComposer(
            $db: $db,
            $table: $db.jobs,
            $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
            joinBuilder: joinBuilder,
            $removeJoinBuilderFromRootComposer:
                $removeJoinBuilderFromRootComposer,
          ),
    );
    return composer;
  }
}

class $$SimsTableAnnotationComposer extends Composer<_$AppDb, $SimsTable> {
  $$SimsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<int> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<int> get simIndex =>
      $composableBuilder(column: $table.simIndex, builder: (column) => column);

  GeneratedColumn<String> get state =>
      $composableBuilder(column: $table.state, builder: (column) => column);

  GeneratedColumn<String> get winnerDeckName => $composableBuilder(
    column: $table.winnerDeckName,
    builder: (column) => column,
  );

  GeneratedColumn<int> get winningTurn => $composableBuilder(
    column: $table.winningTurn,
    builder: (column) => column,
  );

  GeneratedColumn<int> get durationMs => $composableBuilder(
    column: $table.durationMs,
    builder: (column) => column,
  );

  GeneratedColumn<String> get errorMessage => $composableBuilder(
    column: $table.errorMessage,
    builder: (column) => column,
  );

  GeneratedColumn<String> get logRelPath => $composableBuilder(
    column: $table.logRelPath,
    builder: (column) => column,
  );

  GeneratedColumn<DateTime> get startedAt =>
      $composableBuilder(column: $table.startedAt, builder: (column) => column);

  GeneratedColumn<DateTime> get completedAt => $composableBuilder(
    column: $table.completedAt,
    builder: (column) => column,
  );

  $$JobsTableAnnotationComposer get jobId {
    final $$JobsTableAnnotationComposer composer = $composerBuilder(
      composer: this,
      getCurrentColumn: (t) => t.jobId,
      referencedTable: $db.jobs,
      getReferencedColumn: (t) => t.id,
      builder:
          (
            joinBuilder, {
            $addJoinBuilderToRootComposer,
            $removeJoinBuilderFromRootComposer,
          }) => $$JobsTableAnnotationComposer(
            $db: $db,
            $table: $db.jobs,
            $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
            joinBuilder: joinBuilder,
            $removeJoinBuilderFromRootComposer:
                $removeJoinBuilderFromRootComposer,
          ),
    );
    return composer;
  }
}

class $$SimsTableTableManager
    extends
        RootTableManager<
          _$AppDb,
          $SimsTable,
          Sim,
          $$SimsTableFilterComposer,
          $$SimsTableOrderingComposer,
          $$SimsTableAnnotationComposer,
          $$SimsTableCreateCompanionBuilder,
          $$SimsTableUpdateCompanionBuilder,
          (Sim, $$SimsTableReferences),
          Sim,
          PrefetchHooks Function({bool jobId})
        > {
  $$SimsTableTableManager(_$AppDb db, $SimsTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$SimsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$SimsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$SimsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<int> id = const Value.absent(),
                Value<int> jobId = const Value.absent(),
                Value<int> simIndex = const Value.absent(),
                Value<String> state = const Value.absent(),
                Value<String?> winnerDeckName = const Value.absent(),
                Value<int?> winningTurn = const Value.absent(),
                Value<int?> durationMs = const Value.absent(),
                Value<String?> errorMessage = const Value.absent(),
                Value<String?> logRelPath = const Value.absent(),
                Value<DateTime?> startedAt = const Value.absent(),
                Value<DateTime?> completedAt = const Value.absent(),
              }) => SimsCompanion(
                id: id,
                jobId: jobId,
                simIndex: simIndex,
                state: state,
                winnerDeckName: winnerDeckName,
                winningTurn: winningTurn,
                durationMs: durationMs,
                errorMessage: errorMessage,
                logRelPath: logRelPath,
                startedAt: startedAt,
                completedAt: completedAt,
              ),
          createCompanionCallback:
              ({
                Value<int> id = const Value.absent(),
                required int jobId,
                required int simIndex,
                Value<String> state = const Value.absent(),
                Value<String?> winnerDeckName = const Value.absent(),
                Value<int?> winningTurn = const Value.absent(),
                Value<int?> durationMs = const Value.absent(),
                Value<String?> errorMessage = const Value.absent(),
                Value<String?> logRelPath = const Value.absent(),
                Value<DateTime?> startedAt = const Value.absent(),
                Value<DateTime?> completedAt = const Value.absent(),
              }) => SimsCompanion.insert(
                id: id,
                jobId: jobId,
                simIndex: simIndex,
                state: state,
                winnerDeckName: winnerDeckName,
                winningTurn: winningTurn,
                durationMs: durationMs,
                errorMessage: errorMessage,
                logRelPath: logRelPath,
                startedAt: startedAt,
                completedAt: completedAt,
              ),
          withReferenceMapper: (p0) => p0
              .map(
                (e) =>
                    (e.readTable(table), $$SimsTableReferences(db, table, e)),
              )
              .toList(),
          prefetchHooksCallback: ({jobId = false}) {
            return PrefetchHooks(
              db: db,
              explicitlyWatchedTables: [],
              addJoins:
                  <
                    T extends TableManagerState<
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic
                    >
                  >(state) {
                    if (jobId) {
                      state =
                          state.withJoin(
                                currentTable: table,
                                currentColumn: table.jobId,
                                referencedTable: $$SimsTableReferences
                                    ._jobIdTable(db),
                                referencedColumn: $$SimsTableReferences
                                    ._jobIdTable(db)
                                    .id,
                              )
                              as T;
                    }

                    return state;
                  },
              getPrefetchedDataCallback: (items) async {
                return [];
              },
            );
          },
        ),
      );
}

typedef $$SimsTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDb,
      $SimsTable,
      Sim,
      $$SimsTableFilterComposer,
      $$SimsTableOrderingComposer,
      $$SimsTableAnnotationComposer,
      $$SimsTableCreateCompanionBuilder,
      $$SimsTableUpdateCompanionBuilder,
      (Sim, $$SimsTableReferences),
      Sim,
      PrefetchHooks Function({bool jobId})
    >;
typedef $$SettingsTableCreateCompanionBuilder =
    SettingsCompanion Function({
      required String key,
      required String value,
      Value<int> rowid,
    });
typedef $$SettingsTableUpdateCompanionBuilder =
    SettingsCompanion Function({
      Value<String> key,
      Value<String> value,
      Value<int> rowid,
    });

class $$SettingsTableFilterComposer extends Composer<_$AppDb, $SettingsTable> {
  $$SettingsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get key => $composableBuilder(
    column: $table.key,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get value => $composableBuilder(
    column: $table.value,
    builder: (column) => ColumnFilters(column),
  );
}

class $$SettingsTableOrderingComposer
    extends Composer<_$AppDb, $SettingsTable> {
  $$SettingsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get key => $composableBuilder(
    column: $table.key,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get value => $composableBuilder(
    column: $table.value,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$SettingsTableAnnotationComposer
    extends Composer<_$AppDb, $SettingsTable> {
  $$SettingsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get key =>
      $composableBuilder(column: $table.key, builder: (column) => column);

  GeneratedColumn<String> get value =>
      $composableBuilder(column: $table.value, builder: (column) => column);
}

class $$SettingsTableTableManager
    extends
        RootTableManager<
          _$AppDb,
          $SettingsTable,
          Setting,
          $$SettingsTableFilterComposer,
          $$SettingsTableOrderingComposer,
          $$SettingsTableAnnotationComposer,
          $$SettingsTableCreateCompanionBuilder,
          $$SettingsTableUpdateCompanionBuilder,
          (Setting, BaseReferences<_$AppDb, $SettingsTable, Setting>),
          Setting,
          PrefetchHooks Function()
        > {
  $$SettingsTableTableManager(_$AppDb db, $SettingsTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$SettingsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$SettingsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$SettingsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> key = const Value.absent(),
                Value<String> value = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => SettingsCompanion(key: key, value: value, rowid: rowid),
          createCompanionCallback:
              ({
                required String key,
                required String value,
                Value<int> rowid = const Value.absent(),
              }) => SettingsCompanion.insert(
                key: key,
                value: value,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$SettingsTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDb,
      $SettingsTable,
      Setting,
      $$SettingsTableFilterComposer,
      $$SettingsTableOrderingComposer,
      $$SettingsTableAnnotationComposer,
      $$SettingsTableCreateCompanionBuilder,
      $$SettingsTableUpdateCompanionBuilder,
      (Setting, BaseReferences<_$AppDb, $SettingsTable, Setting>),
      Setting,
      PrefetchHooks Function()
    >;

class $AppDbManager {
  final _$AppDb _db;
  $AppDbManager(this._db);
  $$JobsTableTableManager get jobs => $$JobsTableTableManager(_db, _db.jobs);
  $$SimsTableTableManager get sims => $$SimsTableTableManager(_db, _db.sims);
  $$SettingsTableTableManager get settings =>
      $$SettingsTableTableManager(_db, _db.settings);
}
